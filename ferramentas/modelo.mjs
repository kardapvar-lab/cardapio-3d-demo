// Tratamento dos scans 3D pro cardápio, usado por preparar-scans.mjs (Sketchfab) e novo-prato.mjs
// (scan feito por nós): recorta o fundo, põe em escala real (1 unidade = 1 metro, base em y = 0,
// centro na origem), reduz triângulos e texturas pra abrir rápido no celular e troca o material
// "unlit" do scan por um material normal sem brilho (o Quick Look do iPhone ignora malhas unlit).
//
// Roda igual no Node (modelo-node.mjs, com o sharp) e no navegador (cadastrar.html, com canvas):
// o que mexe em imagem vem de fora, em `imagens`:
//   decodificar(bytes) -> { data: RGBA, info: { width, height } }   (só pra etapa "escuro")
//   comprimir(doc)     -> reduz as texturas pra TEXTURA px em JPEG
import { weld, simplify, prune, dedup, getBounds, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

export const TEXTURA = 1024;
export const TRIANGULOS = 60000; // "reduzir": "auto" deixa mais ou menos isso (abre rápido no celular)

// Etapas (em ordem; as coordenadas de recorte valem para o resultado da etapa anterior):
//   reduzir: fração de triângulos que fica       recorte: cilindro {cx, cz, r} (metros) que fica
//   escuro: tira triângulos com cor mais escura que isso (0-255), exceto dentro de foraDe
//   maiorPeca: fica só a maior parte conectada   giro: graus em Y (qual lado fica de frente)
//   tirarMesa: tira o tampo da mesa em volta (a superfície plana mais baixa, fora do prato)
//   diametro: maior medida horizontal real em metros (sem isso o scan já está em metros)

const primitivas = (root) => root.listMeshes().flatMap((m) => m.listPrimitives());

function cadaVertice(root, f) {
  const v = [0, 0, 0];
  for (const p of primitivas(root)) {
    const pos = p.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); pos.setElement(i, f(v)); }
  }
}

// Junta todos os nós num só sistema de coordenadas (aplica as matrizes nos vértices).
async function achatar(doc) {
  const root = doc.getRoot();
  await doc.transform(flatten());
  for (const node of root.listNodes()) {
    const m = node.getMesh();
    if (!m) continue;
    const w = node.getWorldMatrix();
    const v = [0, 0, 0];
    for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const [x, y, z] = v;
        pos.setElement(i, [w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14]]);
      }
    }
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
}

function recortar(root, { cx, cz, r }) {
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (const p of primitivas(root)) {
    const pos = p.getAttribute('POSITION'), tri = p.getIndices().getArray(), fica = [];
    for (let t = 0; t < tri.length; t += 3) {
      pos.getElement(tri[t], a); pos.getElement(tri[t + 1], b); pos.getElement(tri[t + 2], c);
      const x = (a[0] + b[0] + c[0]) / 3, z = (a[2] + b[2] + c[2]) / 3;
      if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) fica.push(tri[t], tri[t + 1], tri[t + 2]);
    }
    p.getIndices().setArray(new Uint32Array(fica));
  }
}

// Tira o tampo da mesa que o scan pega em volta do prato: entre as superfícies quase horizontais,
// a mesa é a mais baixa com bastante área. Some tudo até 2 faixas acima dela (faixa = 0,5% do
// tamanho do scan: num scan de 40 cm, uns 4 mm), então a comida rasa (o miolo de uma pizza) fica.
// Os limites são frações do tamanho, então funciona mesmo se o app não exportou em metros.
function tirarMesa(root) {
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  const planos = []; // [altura, área] dos triângulos deitados
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const p of primitivas(root)) {
    const pos = p.getAttribute('POSITION'), tri = p.getIndices().getArray();
    for (let t = 0; t < tri.length; t += 3) {
      pos.getElement(tri[t], a); pos.getElement(tri[t + 1], b); pos.getElement(tri[t + 2], c);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, dobro = Math.hypot(nx, ny, nz);
      if (dobro > 0 && Math.abs(ny) / dobro > 0.95) planos.push([(a[1] + b[1] + c[1]) / 3, dobro / 2]);
      for (const v of [a, b, c]) { xMin = Math.min(xMin, v[0]); xMax = Math.max(xMax, v[0]); zMin = Math.min(zMin, v[2]); zMax = Math.max(zMax, v[2]); }
    }
  }
  if (!planos.length) return;
  const tamanho = Math.max(xMax - xMin, zMax - zMin), faixa = tamanho * 0.005;
  const area = new Map();
  for (const [y, ar] of planos) { const k = Math.floor(y / faixa); area.set(k, (area.get(k) || 0) + ar); }
  const maior = Math.max(...area.values());
  const mesa = Math.min(...[...area].filter(([, ar]) => ar >= maior * 0.15).map(([k]) => k)) * faixa;
  const corte = mesa + 2 * faixa;
  for (const p of primitivas(root)) {
    const pos = p.getAttribute('POSITION'), tri = p.getIndices().getArray(), fica = [];
    for (let t = 0; t < tri.length; t += 3) {
      pos.getElement(tri[t], a); pos.getElement(tri[t + 1], b); pos.getElement(tri[t + 2], c);
      if ((a[1] + b[1] + c[1]) / 3 > corte) fica.push(tri[t], tri[t + 1], tri[t + 2]);
    }
    p.getIndices().setArray(new Uint32Array(fica));
  }
}

// Tira triângulos escuros (pela cor da textura nos vértices), menos os que estão dentro de foraDe.
async function tirarEscuro(root, limite, foraDe, imagens) {
  for (const p of primitivas(root)) {
    const tex = p.getMaterial().getBaseColorTexture();
    const { data, info } = await imagens.decodificar(tex.getImage());
    const uv = p.getAttribute('TEXCOORD_0'), pos = p.getAttribute('POSITION'), t = [0, 0], q = [0, 0, 0];
    const brilho = (i) => {
      uv.getElement(i, t);
      const x = Math.min(info.width - 1, Math.floor((((t[0] % 1) + 1) % 1) * info.width));
      const y = Math.min(info.height - 1, Math.floor((((t[1] % 1) + 1) % 1) * info.height));
      const k = (y * info.width + x) * 4;
      return 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
    };
    const tri = p.getIndices().getArray(), fica = [];
    for (let i = 0; i < tri.length; i += 3) {
      pos.getElement(tri[i], q);
      const protegido = foraDe && Math.hypot(q[0] - foraDe.cx, q[2] - foraDe.cz) < foraDe.r;
      const media = (brilho(tri[i]) + brilho(tri[i + 1]) + brilho(tri[i + 2])) / 3;
      if (protegido || media >= limite) fica.push(tri[i], tri[i + 1], tri[i + 2]);
    }
    p.getIndices().setArray(new Uint32Array(fica));
  }
}

// Identifica vértices pela posição (a costura da UV duplica vértices no mesmo lugar).
function idPorPosicao(pos, casas) {
  const chave = new Map(), id = new Int32Array(pos.getCount()), v = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v);
    const k = v.map((a) => Math.round(a * casas)).join(',');
    if (!chave.has(k)) chave.set(k, chave.size);
    id[i] = chave.get(k);
  }
  return { id, total: chave.size };
}

// Malhas que os cortes deixaram sem nenhum triângulo (ex.: a mesa, quando o app exporta ela separada).
function tirarVazias(root) {
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) if (p.getIndices().getCount() === 0) p.dispose();
    if (m.listPrimitives().length === 0) m.dispose();
  }
}

function maiorPeca(root) {
  for (const p of primitivas(root)) {
    const tri = Array.from(p.getIndices().getArray());
    const { id, total } = idPorPosicao(p.getAttribute('POSITION'), 1e4);
    const pai = new Int32Array(total).map((_, i) => i);
    const raiz = (a) => { while (pai[a] !== a) { pai[a] = pai[pai[a]]; a = pai[a]; } return a; };
    for (let i = 0; i < tri.length; i += 3) {
      const a = raiz(id[tri[i]]);
      pai[raiz(id[tri[i + 1]])] = a;
      pai[raiz(id[tri[i + 2]])] = a;
    }
    const conta = new Map();
    for (let i = 0; i < tri.length; i += 3) { const r = raiz(id[tri[i]]); conta.set(r, (conta.get(r) || 0) + 1); }
    const maior = [...conta.entries()].sort((a, b) => b[1] - a[1])[0][0];
    p.getIndices().setArray(new Uint32Array(tri.filter((_, j) => raiz(id[tri[j - (j % 3)]]) === maior)));
  }
}

// Normais suaves (os scans unlit vêm sem): média das faces, juntando os vértices da costura da UV.
function normaisSuaves(doc) {
  const root = doc.getRoot();
  for (const p of primitivas(root)) {
    if (p.getAttribute('NORMAL')) continue;
    const pos = p.getAttribute('POSITION'), tri = p.getIndices().getArray(), n = pos.getCount();
    const { id, total } = idPorPosicao(pos, 1e5);
    const soma = new Float32Array(total * 3), a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    for (let t = 0; t < tri.length; t += 3) {
      pos.getElement(tri[t], a); pos.getElement(tri[t + 1], b); pos.getElement(tri[t + 2], c);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; // peso pela área
      for (const j of [tri[t], tri[t + 1], tri[t + 2]]) { const q = id[j] * 3; soma[q] += nx; soma[q + 1] += ny; soma[q + 2] += nz; }
    }
    const normais = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const q = id[i] * 3, l = Math.hypot(soma[q], soma[q + 1], soma[q + 2]) || 1;
      normais[i * 3] = soma[q] / l; normais[i * 3 + 1] = soma[q + 1] / l; normais[i * 3 + 2] = soma[q + 2] / l;
    }
    p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normais).setBuffer(root.listBuffers()[0]));
  }
}

export const triangulos = (doc) => primitivas(doc.getRoot()).reduce((s, p) => s + p.getIndices().getCount() / 3, 0);

export async function etapa(doc, e, imagens) {
  const root = doc.getRoot();
  await achatar(doc);
  if (e.recorte) recortar(root, e.recorte);
  await doc.transform(dedup(), join(), weld({}), prune());
  if (e.tirarMesa) tirarMesa(root);
  if (e.escuro) await tirarEscuro(root, e.escuro, e.foraDe, imagens);
  tirarVazias(root);
  if (e.maiorPeca) maiorPeca(root);
  await doc.transform(prune());
  const reduzir = e.reduzir === 'auto' ? Math.min(1, TRIANGULOS / triangulos(doc)) : e.reduzir;
  if (reduzir && reduzir < 1) {
    await MeshoptSimplifier.ready;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: reduzir, error: 0.002, lockBorder: false }), prune());
  }
  if (e.giro) {
    const g = (e.giro * Math.PI) / 180, cos = Math.cos(g), sen = Math.sin(g);
    cadaVertice(root, ([x, y, z]) => [cos * x + sen * z, y, -sen * x + cos * z]);
  }
  // escala real, centro na origem e base em y = 0
  const b = getBounds(root.listScenes()[0]);
  const k = e.diametro ? e.diametro / Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) : 1;
  const cx = (b.max[0] + b.min[0]) / 2, cz = (b.max[2] + b.min[2]) / 2, y0 = b.min[1];
  cadaVertice(root, ([x, y, z]) => [(x - cx) * k, (y - y0) * k, (z - cz) * k]);
}

// Depois das etapas: normais, material sem brilho e texturas leves.
export async function finalizar(doc, imagens) {
  const root = doc.getRoot();
  normaisSuaves(doc);
  for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_unlit') ext.dispose();
  for (const m of root.listMaterials()) m.setMetallicFactor(0).setRoughnessFactor(0.9);
  await imagens.comprimir(doc);
  await doc.transform(prune());
}

// Medidas em cm e triângulos, pra conferir.
export function resumo(doc) {
  const root = doc.getRoot();
  const b = getBounds(root.listScenes()[0]);
  const [largura, altura, fundo] = b.max.map((v, i) => Math.round((v - b.min[i]) * 100));
  return { largura, altura, fundo, triangulos: triangulos(doc) };
}
