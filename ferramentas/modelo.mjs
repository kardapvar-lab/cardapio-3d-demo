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
//   nivelar: deixa o prato reto (scan torto)       abaixoDe: tira o que está abaixo dessa altura (m, da base)

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

// Tira o tampo da mesa que o scan pega em volta do prato. A mesa quase nunca sai reta no scan
// (1° ou 2° de inclinação já bastam pra um corte numa altura fixa deixar meia mesa), então acha o
// plano dela: entre os planos formados pelas superfícies quase horizontais, a mesa é o mais baixo
// com bastante área. Some tudo até um pouco acima desse plano (2 faixas, faixa = 0,5% do tamanho do
// scan, ou mais se o scan da mesa for ondulado), a comida rasa (o miolo de uma pizza) fica, e o
// modelo é girado pra mesa ficar reta. Devolve a altura da mesa depois do giro (pra maiorPeca).
// Os limites são frações do tamanho, então funciona mesmo se o app não exportou em metros.
function tirarMesa(root) {
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  const deitados = []; // [x, y, z, área] do centro dos triângulos quase horizontais
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const p of primitivas(root)) {
    const pos = p.getAttribute('POSITION'), tri = p.getIndices().getArray();
    for (let t = 0; t < tri.length; t += 3) {
      pos.getElement(tri[t], a); pos.getElement(tri[t + 1], b); pos.getElement(tri[t + 2], c);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, dobro = Math.hypot(nx, ny, nz);
      if (dobro > 0 && Math.abs(ny) / dobro > 0.95) {
        deitados.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3, dobro / 2]);
      }
      for (const v of [a, b, c]) { xMin = Math.min(xMin, v[0]); xMax = Math.max(xMax, v[0]); zMin = Math.min(zMin, v[2]); zMax = Math.max(zMax, v[2]); }
    }
  }
  if (deitados.length < 3) return null;
  const tamanho = Math.max(xMax - xMin, zMax - zMin), faixa = tamanho * 0.005;

  // planos y = ax + bz + c por 3 pontos sorteados (sorteio fixo: o mesmo scan dá sempre o mesmo
  // resultado), só os quase horizontais; área de cada um = soma da área dos triângulos a 1 faixa dele
  const amostra = deitados.length > 4000 ? deitados.filter((_, i) => i % Math.ceil(deitados.length / 4000) === 0) : deitados;
  let semente = 12345;
  const sorteio = () => (semente = (semente * 16807) % 2147483647) % amostra.length;
  const planos = [];
  for (let k = 0; k < 400; k++) {
    const [p, q, r] = [amostra[sorteio()], amostra[sorteio()], amostra[sorteio()]];
    const det = (q[0] - p[0]) * (r[2] - p[2]) - (r[0] - p[0]) * (q[2] - p[2]);
    if (Math.abs(det) < tamanho * tamanho * 1e-4) continue; // pontos quase em linha
    const pa = ((q[1] - p[1]) * (r[2] - p[2]) - (r[1] - p[1]) * (q[2] - p[2])) / det;
    const pb = ((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / det;
    if (Math.hypot(pa, pb) > 0.3) continue; // mais de ~17°: não é mesa
    const pc = p[1] - pa * p[0] - pb * p[2];
    let area = 0, alturaMedia = 0;
    for (const [x, y, z, ar] of amostra) if (Math.abs(y - (pa * x + pb * z + pc)) < faixa) { area += ar; alturaMedia += ar * y; }
    planos.push({ a: pa, b: pb, c: pc, area, altura: alturaMedia / area });
  }
  if (!planos.length) return null;
  const maior = Math.max(...planos.map((p) => p.area));
  const mesa = planos.filter((p) => p.area >= maior * 0.15).sort((p, q) => p.altura - q.altura)[0];

  // acerta o plano com todos os pontos perto dele (mínimos quadrados) e mede o quanto a mesa ondula
  const perto = deitados.filter(([x, y, z]) => Math.abs(y - (mesa.a * x + mesa.b * z + mesa.c)) < 2 * faixa);
  let [sxx, sxz, szz, sx, sz, sw, sxy, szy, sy] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const [x, y, z, w] of perto) {
    sxx += w * x * x; sxz += w * x * z; szz += w * z * z; sx += w * x; sz += w * z; sw += w;
    sxy += w * x * y; szy += w * z * y; sy += w * y;
  }
  const m = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, sw]], v = [sxy, szy, sy];
  const d = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D = d(m);
  const plano = Math.abs(D) > 1e-30
    ? [0, 1, 2].map((k) => d(m.map((linha, i) => linha.map((x, j) => (j === k ? v[i] : x)))) / D)
    : [mesa.a, mesa.b, mesa.c];
  const acima = (x, y, z) => (y - (plano[0] * x + plano[1] * z + plano[2])) / Math.hypot(plano[0], plano[1], 1);
  let quad = 0, peso = 0;
  for (const [x, y, z, w] of perto) { quad += w * acima(x, y, z) ** 2; peso += w; }
  const corte = Math.max(2 * faixa, 3 * Math.sqrt(quad / (peso || 1)));

  for (const p of primitivas(root)) {
    const pos = p.getAttribute('POSITION'), tri = p.getIndices().getArray(), fica = [];
    for (let t = 0; t < tri.length; t += 3) {
      pos.getElement(tri[t], a); pos.getElement(tri[t + 1], b); pos.getElement(tri[t + 2], c);
      if (acima((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3) > corte) fica.push(tri[t], tri[t + 1], tri[t + 2]);
    }
    p.getIndices().setArray(new Uint32Array(fica));
  }

  // gira pra mesa ficar reta: leva a normal do plano (-a, 1, -b) pra (0, 1, 0)
  const l = Math.hypot(plano[0], plano[1], 1), n = [-plano[0] / l, 1 / l, -plano[1] / l];
  const eixo = [-n[2], 0, n[0]], sen = Math.hypot(eixo[0], eixo[2]), cos = n[1]; // n × (0, 1, 0)
  if (sen > 1e-6) {
    const k = [eixo[0] / sen, 0, eixo[2] / sen];
    cadaVertice(root, (q) => { // Rodrigues
      const kq = k[0] * q[0] + k[2] * q[2];
      const cr = [k[1] * q[2] - k[2] * q[1], k[2] * q[0] - k[0] * q[2], k[0] * q[1] - k[1] * q[0]];
      return [0, 1, 2].map((i) => q[i] * cos + cr[i] * sen + k[i] * kq * (1 - cos));
    });
  }
  return plano[2] / l; // a origem do plano depois do giro: a mesa fica em y = c / |n|
}

// Nivela o prato: um prato com comida é um disco largo e baixo, então a direção de menor espalhamento
// (o menor autovetor da covariância, pesada pela área dos triângulos) é a "vertical" do prato.
// Gira tudo para essa direção virar +Y. Serve para scans que vieram tortos.
function nivelar(root) {
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  let soma = 0;
  const m = [0, 0, 0];
  const pts = [];
  for (const p of primitivas(root)) {
    const pos = p.getAttribute('POSITION'), tri = p.getIndices().getArray();
    for (let t = 0; t < tri.length; t += 3) {
      pos.getElement(tri[t], a); pos.getElement(tri[t + 1], b); pos.getElement(tri[t + 2], c);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
      const area = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
      const g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      pts.push([g, area]); soma += area;
      for (let k = 0; k < 3; k++) m[k] += g[k] * area;
    }
  }
  if (!soma) return;
  for (let k = 0; k < 3; k++) m[k] /= soma;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const [g, w] of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += w * (g[i] - m[i]) * (g[j] - m[j]);
  // autovetores 3x3 (Jacobi)
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 50; it++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(C[i][j]) > Math.abs(C[p][q])) { p = i; q = j; }
    if (Math.abs(C[p][q]) < 1e-14) break;
    const th = 0.5 * Math.atan2(2 * C[p][q], C[q][q] - C[p][p]), cs = Math.cos(th), sn = Math.sin(th);
    for (let k = 0; k < 3; k++) { const x = C[k][p], y = C[k][q]; C[k][p] = cs * x - sn * y; C[k][q] = sn * x + cs * y; }
    for (let k = 0; k < 3; k++) { const x = C[p][k], y = C[q][k]; C[p][k] = cs * x - sn * y; C[q][k] = sn * x + cs * y; }
    for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = cs * x - sn * y; V[k][q] = sn * x + cs * y; }
  }
  const menor = [0, 1, 2].sort((i, j) => C[i][i] - C[j][j])[0];
  let n = [V[0][menor], V[1][menor], V[2][menor]];
  if (n[1] < 0) n = n.map((x) => -x); // o scan vem mais ou menos em pé: mantém o "para cima"
  // rotação que leva n para +Y (Rodrigues)
  const eixo = [n[2], 0, -n[0]], s = Math.hypot(...eixo), cosA = n[1];
  if (s < 1e-6) return;
  const k = eixo.map((x) => x / s), ang = Math.atan2(s, cosA), co = Math.cos(ang), si = Math.sin(ang);
  cadaVertice(root, (v) => {
    const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    const cr = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    return [0, 1, 2].map((i) => v[i] * co + cr[i] * si + k[i] * d * (1 - co));
  });
}

// Tira tudo abaixo de uma altura (suporte, pé de mesa ou tripé que o scan pegou embaixo do prato).
// abaixoDe em metros, medido da base do modelo como ele está ao chegar nesta etapa.
function cortarAbaixo(root, abaixoDe) {
  const b = getBounds(root.listScenes()[0]);
  const corte = b.min[1] + abaixoDe;
  const a = [0, 0, 0], bb = [0, 0, 0], c = [0, 0, 0];
  for (const p of primitivas(root)) {
    const pos = p.getAttribute('POSITION'), tri = p.getIndices().getArray(), fica = [];
    for (let t = 0; t < tri.length; t += 3) {
      pos.getElement(tri[t], a); pos.getElement(tri[t + 1], bb); pos.getElement(tri[t + 2], c);
      if (Math.min(a[1], bb[1], c[1]) >= corte) fica.push(tri[t], tri[t + 1], tri[t + 2]);
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

// Fica só a maior peça conectada. Depois de tirar a mesa (yMesa), "maior" é a de mais volume acima
// da mesa, não a de mais triângulos: sobra de mesa é rasa e não pode ganhar da laranja.
function maiorPeca(root, yMesa = null) {
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (const p of primitivas(root)) {
    const pos = p.getAttribute('POSITION');
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
    for (let i = 0; i < tri.length; i += 3) {
      const r = raiz(id[tri[i]]);
      let valor = 1;
      if (yMesa !== null) {
        pos.getElement(tri[i], a); pos.getElement(tri[i + 1], b); pos.getElement(tri[i + 2], c);
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
        const area = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
        valor = area * Math.max(0, (a[1] + b[1] + c[1]) / 3 - yMesa);
      }
      conta.set(r, (conta.get(r) || 0) + valor);
    }
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
  await doc.transform(dedup(), join(), weld({}), prune());
  if (e.nivelar) nivelar(root);
  if (e.abaixoDe) cortarAbaixo(root, e.abaixoDe);
  if (e.recorte) recortar(root, e.recorte);
  const yMesa = e.tirarMesa ? tirarMesa(root) : null;
  if (e.escuro) await tirarEscuro(root, e.escuro, e.foraDe, imagens);
  tirarVazias(root);
  if (e.maiorPeca) maiorPeca(root, yMesa ?? null);
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

// Contorno convexo (cadeia monótona) de pontos [x, z].
function contorno(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const giro = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const baixo = [], cima = [];
  for (const q of p) { while (baixo.length >= 2 && giro(baixo.at(-2), baixo.at(-1), q) <= 0) baixo.pop(); baixo.push(q); }
  for (const q of p.reverse()) { while (cima.length >= 2 && giro(cima.at(-2), cima.at(-1), q) <= 0) cima.pop(); cima.push(q); }
  return baixo.slice(0, -1).concat(cima.slice(0, -1));
}

// Fecha o fundo: o scan nunca vê a parte encostada na mesa, então por baixo o prato fica "vazado"
// (e dá pra ver por dentro da comida). Põe uma tampa plana em y ≈ 0 com o contorno da base e a cor
// média da borda de baixo, um pouco mais escura (é a parte de baixo do prato).
async function fecharFundo(doc, imagens) {
  const root = doc.getRoot();
  const b = getBounds(root.listScenes()[0]);
  const altura = b.max[1] - b.min[1];
  const limite = b.min[1] + Math.max(0.004, altura * 0.08);
  const pts = [], v = [0, 0, 0], t = [0, 0];
  let soma = [0, 0, 0], n = 0;
  // Área de baixo já escaneada: soma da área projetada dos triângulos virados para baixo.
  const a = [0, 0, 0], bb = [0, 0, 0], c = [0, 0, 0];
  let areaBaixo = 0;
  for (const p of primitivas(root)) {
    const pos = p.getAttribute('POSITION'), tri = p.getIndices().getArray();
    for (let k = 0; k < tri.length; k += 3) {
      pos.getElement(tri[k], a); pos.getElement(tri[k + 1], bb); pos.getElement(tri[k + 2], c);
      const ny = (bb[2] - a[2]) * (c[0] - a[0]) - (bb[0] - a[0]) * (c[2] - a[2]);
      if (ny < 0) areaBaixo += -ny / 2;
    }
  }
  for (const p of primitivas(root)) {
    const pos = p.getAttribute('POSITION'), uv = p.getAttribute('TEXCOORD_0');
    const tex = p.getMaterial() && p.getMaterial().getBaseColorTexture();
    let img = null;
    if (tex && uv && imagens && imagens.decodificar) { try { img = await imagens.decodificar(tex.getImage()); } catch (e) { img = null; } }
    // só os vértices que ainda estão em algum triângulo: tirarMesa corta os triângulos da mesa,
    // mas os vértices dela continuam no arquivo e a tampa sairia do tamanho da mesa
    const usados = new Uint8Array(pos.getCount());
    for (const i of p.getIndices().getArray()) usados[i] = 1;
    for (let i = 0; i < pos.getCount(); i++) {
      if (!usados[i]) continue;
      pos.getElement(i, v);
      pts.push([v[0], v[2]]); // contorno do prato inteiro (a borda costuma ser mais larga que a base)
      if (v[1] > limite) continue;
      if (img) {
        uv.getElement(i, t);
        const x = Math.min(img.info.width - 1, Math.floor((((t[0] % 1) + 1) % 1) * img.info.width));
        const y = Math.min(img.info.height - 1, Math.floor((((t[1] % 1) + 1) % 1) * img.info.height));
        const k = (y * img.info.width + x) * 4;
        soma[0] += img.data[k]; soma[1] += img.data[k + 1]; soma[2] += img.data[k + 2]; n++;
      }
    }
  }
  const borda = contorno(pts);
  if (borda.length < 3) return false;
  let areaContorno = 0;
  for (let i = 0; i < borda.length; i++) {
    const [x1, z1] = borda[i], [x2, z2] = borda[(i + 1) % borda.length];
    areaContorno += (x1 * z2 - x2 * z1) / 2;
  }
  // Se o scan já tem fundo (mais de 60% da área por baixo), não tampa: o fundo real é melhor.
  if (areaBaixo > Math.abs(areaContorno) * 0.6) return false;
  const cor = n ? soma.map((s) => ((s / n) / 255) * 0.85) : [0.8, 0.8, 0.8];
  // vértices: centro + contorno, um pouco acima da base para não brigar com a sombra
  const y = b.min[1] + 0.0008;
  const cx = borda.reduce((s, q) => s + q[0], 0) / borda.length, cz = borda.reduce((s, q) => s + q[1], 0) / borda.length;
  const posicoes = [cx, y, cz, ...borda.flatMap(([x, z]) => [x, y, z])];
  const indices = [];
  for (let i = 0; i < borda.length; i++) {
    const a = 1 + i, c = 1 + ((i + 1) % borda.length);
    // virada para baixo: normal com y negativo
    const [x1, z1] = borda[i], [x2, z2] = borda[(i + 1) % borda.length];
    const ny = (z1 - cz) * (x2 - cx) - (x1 - cx) * (z2 - cz);
    if (ny < 0) indices.push(0, a, c); else indices.push(0, c, a);
  }
  const buf = root.listBuffers()[0];
  const qtd = posicoes.length / 3;
  const normais = new Float32Array(qtd * 3);
  for (let i = 0; i < qtd; i++) normais[i * 3 + 1] = -1;
  const material = doc.createMaterial('fundo').setBaseColorFactor([...cor, 1]).setMetallicFactor(0).setRoughnessFactor(0.9);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(posicoes)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normais).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buf))
    .setMaterial(material);
  const no = doc.createNode('fundo').setMesh(doc.createMesh('fundo').addPrimitive(prim));
  root.listScenes()[0].addChild(no);
  return true;
}

// Depois das etapas: normais, material sem brilho e texturas leves.
// opcoes.fecharFundo: tampa a base (ver fecharFundo).
// opcoes.manterMaterial: não troca metal/rugosidade (para objetos modelados, como uma lata).
export async function finalizar(doc, imagens, opcoes = {}) {
  const root = doc.getRoot();
  normaisSuaves(doc);
  const fechouFundo = opcoes.fecharFundo ? await fecharFundo(doc, imagens) : false;
  // dupla face: buracos pequenos do scan mostram a cor do lado de dentro em vez de "sumir"
  for (const m of root.listMaterials()) if (m.getName() !== 'fundo') m.setDoubleSided(true);
  for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_unlit') ext.dispose();
  // scans de comida: material fosco. Objetos modelados (lata, garrafa) mantêm o metal/brilho original.
  if (!opcoes.manterMaterial) for (const m of root.listMaterials()) m.setMetallicFactor(0).setRoughnessFactor(0.9);
  await imagens.comprimir(doc);
  await doc.transform(prune());
  return { fechouFundo };
}

// Medidas em cm e triângulos, pra conferir.
export function resumo(doc) {
  const root = doc.getRoot();
  const b = getBounds(root.listScenes()[0]);
  const [largura, altura, fundo] = b.max.map((v, i) => Math.round((v - b.min[i]) * 100));
  return { largura, altura, fundo, triangulos: triangulos(doc) };
}
