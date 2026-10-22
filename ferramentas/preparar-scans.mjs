// Baixa os scans reais dos pratos (Sketchfab, CC BY 4.0) e prepara para o cardápio:
// recorta o fundo, põe em escala real (1 unidade = 1 metro, base em y = 0, centro na origem),
// reduz triângulos e texturas para abrir rápido no celular e troca o material "unlit" do scan
// por um material normal sem brilho (o Quick Look do iPhone ignora malhas unlit).
//
// Uso: cd ferramentas && npm install @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 \
//        @gltf-transform/functions@4.1.1 meshoptimizer@0.22.0 sharp@0.33.5
//      SKETCHFAB_TOKEN=... node preparar-scans.mjs ../modelos
// O token fica em sketchfab.com → Settings → Password & API. Os créditos estão no rodapé do index.html.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, getBounds, textureCompress, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

// Cada prato passa pelas etapas em ordem. As coordenadas de recorte valem para o resultado da etapa anterior.
//   reduzir: fração de triângulos que fica       recorte: cilindro {cx, cz, r} (metros) que fica
//   escuro: tira triângulos com cor mais escura que isso (0-255), exceto dentro de foraDe
//   maiorPeca: fica só a maior parte conectada   giro: graus em Y (qual lado fica de frente)
//   diametro: maior medida horizontal real em metros (sem isso o scan já está em metros)
const PRATOS = [
  { arquivo: 'pizza-margherita', uid: '058dc197d2b5417a8f178cca22324442', autor: 'yoshimura.manufacturing',
    etapas: [{ reduzir: 0.2, diametro: 0.33 }] },
  { arquivo: 'hamburguer', uid: '0d339a3a91304192b4fc8d61ebd48bb1', autor: 'keithito',
    etapas: [{ reduzir: 0.35 }] },
  { arquivo: 'pasteis-de-nata', uid: 'ed38059be07544baae16dc8307618675', autor: 'db4',
    etapas: [{}] },
  { arquivo: 'bitoque', uid: '5f556280ccf844eba357af7a5ff7a2b6', autor: 'mrak_CS',
    // o scan vem com a bandeja escura em volta do prato: recorta o prato e tira o que é escuro na borda
    etapas: [
      { reduzir: 0.1 },
      { recorte: { cx: 0.001, cz: 0.024, r: 0.124 }, escuro: 55, foraDe: { cx: 0.001, cz: 0.024, r: 0.113 },
        maiorPeca: true, reduzir: 0.9, giro: -90 },
    ] },
  { arquivo: 'tarte-de-limao', uid: 'db0d8656b7ca4ecd8efb134e2878c477', autor: 'Andrei_Alexandrescu',
    etapas: [{ reduzir: 0.25, diametro: 0.12 }] },
];
const TEXTURA = 1024;

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

// Tira triângulos escuros (pela cor da textura nos vértices), menos os que estão dentro de foraDe.
async function tirarEscuro(root, limite, foraDe) {
  for (const p of primitivas(root)) {
    const tex = p.getMaterial().getBaseColorTexture();
    const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
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

async function etapa(doc, e) {
  const root = doc.getRoot();
  await achatar(doc);
  if (e.recorte) recortar(root, e.recorte);
  await doc.transform(dedup(), join(), weld({}), prune());
  if (e.escuro) await tirarEscuro(root, e.escuro, e.foraDe);
  if (e.maiorPeca) maiorPeca(root);
  await doc.transform(prune());
  if (e.reduzir) {
    await MeshoptSimplifier.ready;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: e.reduzir, error: 0.002, lockBorder: false }), prune());
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

async function baixar(uid, token, destino) {
  if (fs.existsSync(destino)) return;
  const r = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${token}` } });
  if (!r.ok) throw new Error(`Sketchfab respondeu ${r.status} para ${uid}`);
  const { glb } = await r.json();
  const arquivo = await fetch(glb.url);
  fs.writeFileSync(destino, Buffer.from(await arquivo.arrayBuffer()));
}

const SAIDA = process.argv[2] || '../modelos';
const token = process.env.SKETCHFAB_TOKEN;
if (!token) throw new Error('Falta SKETCHFAB_TOKEN');
const CACHE = path.join(SAIDA, '..', 'ferramentas', 'scans-originais');
fs.mkdirSync(CACHE, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const prato of PRATOS) {
  const original = path.join(CACHE, `${prato.arquivo}.glb`);
  await baixar(prato.uid, token, original);
  const doc = await io.read(original);
  const root = doc.getRoot();
  for (const e of prato.etapas) await etapa(doc, e);
  normaisSuaves(doc);
  for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_unlit') ext.dispose();
  for (const m of root.listMaterials()) m.setMetallicFactor(0).setRoughnessFactor(0.9);
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [TEXTURA, TEXTURA], quality: 82 }), prune());
  await io.write(path.join(SAIDA, `${prato.arquivo}.glb`), doc);
  const b = getBounds(root.listScenes()[0]);
  const tam = b.max.map((v, i) => Math.round((v - b.min[i]) * 100));
  const tris = primitivas(root).reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
  console.log(`${prato.arquivo}: ${tam[0]} × ${tam[2]} cm, altura ${tam[1]} cm, ${tris} triângulos (scan de ${prato.autor})`);
}
