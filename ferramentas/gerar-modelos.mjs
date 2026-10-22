// Gera os 5 pratos do demo como arquivos .glb em escala real (1 unidade = 1 metro).
// Uso: cd ferramentas && npm install three@0.169.0 && node gerar-modelos.mjs ../modelos
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import fs from 'node:fs';
import path from 'node:path';

// --- polyfill mínimo para o exportador rodar no Node ---
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((r) => { this.result = r; this.onloadend && this.onloadend(); this.onload && this.onload({ target: this }); });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((r) => {
      this.result = `data:${blob.type};base64,` + Buffer.from(r).toString('base64');
      this.onloadend && this.onloadend(); this.onload && this.onload({ target: this });
    });
  }
};

const OUT = process.argv[2] || './modelos';
fs.mkdirSync(OUT, { recursive: true });

// --- utilidades ---
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const rr = (a, b) => a + (b - a) * rand();

function hash(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return L(
    L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v),
    w
  );
}
function fbm(x, y, z) {
  return noise3(x, y, z) * 0.6 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.3 + noise3(x * 4.3, y * 4.3, z * 4.3) * 0.1;
}

const mat = (color, roughness = 0.7, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

const vmat = (roughness = 0.7, extra = {}) =>
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0, vertexColors: true, ...extra });

// desloca vértices com ruído (para dar aspecto orgânico)
function bumpy(geo, amp, freq, off = 0) {
  geo = geo.clone();
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  if (geo.attributes.normal) geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-6);
  const p = geo.attributes.position;
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = (fbm(x * freq + off, y * freq, z * freq) - 0.5) * 2 * amp;
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  geo.computeVertexNormals();
  return geo;
}

// pinta cada vértice com uma função (x,y,z) -> THREE.Color
function paint(geo, fn) {
  const p = geo.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), c);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, t)));

const mesh = (geo, material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
};

// prato de cerâmica (diâmetro em metros)
function prato(diam = 0.27, cor = 0xf4f1ea) {
  const R = diam / 2;
  const pts = [
    [0, 0.0], [R * 0.55, 0.0], [R * 0.62, 0.004], [R * 0.66, 0.008], [R * 0.7, 0.009],
    [R * 0.9, 0.016], [R, 0.021], [R * 0.995, 0.024], [R * 0.9, 0.0205], [R * 0.7, 0.0125],
    [R * 0.62, 0.012], [0, 0.012],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return mesh(new THREE.LatheGeometry(pts, 96), mat(cor, 0.25));
}

function tabua(w, d, h = 0.018) {
  const shape = new THREE.Shape();
  const r = 0.02;
  shape.moveTo(-w / 2 + r, -d / 2);
  shape.lineTo(w / 2 - r, -d / 2); shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  shape.lineTo(w / 2, d / 2 - r); shape.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  shape.lineTo(-w / 2 + r, d / 2); shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  shape.lineTo(-w / 2, -d / 2 + r); shape.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth: h - 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.002, 0);
  paint(g, (x, y, z, c) => {
    const grain = Math.sin(z * 900 + fbm(x * 30, 0, z * 30) * 8) * 0.5 + 0.5;
    c.copy(mix(0xa8743f, 0x8a5a2b, grain * 0.7 + fbm(x * 8, y, z * 8) * 0.3));
  });
  return mesh(g, vmat(0.8));
}

function tabuaRedonda(diam, h = 0.018) {
  const g = new THREE.CylinderGeometry(diam / 2, diam / 2, h, 96, 1);
  g.translate(0, h / 2, 0);
  paint(g, (x, y, z, c) => {
    const ring = Math.sin(Math.hypot(x, z) * 700 + fbm(x * 20, 0, z * 20) * 6) * 0.5 + 0.5;
    c.copy(mix(0xb07b44, 0x8b5b2c, ring * 0.6 + 0.2));
  });
  return mesh(g, vmat(0.8));
}

// ======================================================
// 1) HAMBÚRGUER
// ======================================================
function hamburguer() {
  const g = new THREE.Group();
  g.add(tabua(0.30, 0.20));
  const base = 0.018;
  const R = 0.056;

  // pão de baixo
  const pb = new THREE.LatheGeometry([
    [0, 0], [R * 0.9, 0], [R * 0.98, 0.004], [R, 0.012], [R * 0.97, 0.02], [0, 0.02],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 64);
  paint(pb, (x, y, z, c) => c.copy(y > 0.018 ? new THREE.Color(0xf3dcae) : mix(0xd9a35a, 0xb97a35, fbm(x * 60, y * 60, z * 60))));
  g.add(mesh(pb, vmat(0.85), 0, base, 0));

  // carne
  let pc = new THREE.CylinderGeometry(R * 1.04, R * 1.02, 0.017, 64, 4);
  pc = bumpy(pc, 0.0022, 140);
  paint(pc, (x, y, z, c) => c.copy(mix(0x3d2214, 0x6b3b22, fbm(x * 120, y * 120, z * 120))));
  g.add(mesh(pc, vmat(0.9), 0, base + 0.0285, 0));

  // queijo (quadrado com pontas caindo)
  const qs = 0.112;
  let q = new THREE.PlaneGeometry(qs, qs, 30, 30);
  q.rotateX(-Math.PI / 2);
  q.rotateY(Math.PI / 4);
  const qp = q.attributes.position;
  for (let i = 0; i < qp.count; i++) {
    const x = qp.getX(i), z = qp.getZ(i);
    const r = Math.hypot(x, z);
    const drop = r > R * 0.95 ? -(r - R * 0.95) * 1.1 : 0;
    qp.setY(i, drop);
  }
  q.computeVertexNormals();
  g.add(mesh(q, mat(0xf2b31b, 0.45, { side: THREE.DoubleSide }), 0, base + 0.0375, 0));

  // alface ondulada
  let al = new THREE.CircleGeometry(R * 1.18, 96, 0, Math.PI * 2);
  al.rotateX(-Math.PI / 2);
  const ap = al.attributes.position;
  for (let i = 0; i < ap.count; i++) {
    const x = ap.getX(i), z = ap.getZ(i);
    const a = Math.atan2(z, x), r = Math.hypot(x, z);
    const k = r / (R * 1.18);
    const rr2 = r * (1 + 0.06 * Math.sin(a * 9) * k);
    ap.setXYZ(i, Math.cos(a) * rr2, Math.sin(a * 14) * 0.004 * k * k - k * k * 0.004, Math.sin(a) * rr2);
  }
  al.computeVertexNormals();
  paint(al, (x, y, z, c) => c.copy(mix(0x9ccc4a, 0x4f9a2a, Math.hypot(x, z) / (R * 1.2))));
  g.add(mesh(al, vmat(0.6, { side: THREE.DoubleSide }), 0, base + 0.040, 0));

  // tomate
  const tm = new THREE.CylinderGeometry(R * 0.82, R * 0.82, 0.006, 48);
  paint(tm, (x, y, z, c) => {
    const r = Math.hypot(x, z) / (R * 0.82);
    c.copy(r > 0.85 ? new THREE.Color(0xc4241b) : mix(0xe2483a, 0xf07a5c, Math.abs(Math.sin(Math.atan2(z, x) * 3)) * (r < 0.6 ? 1 : 0.3)));
  });
  g.add(mesh(tm, vmat(0.35), 0.004, base + 0.0445, 0.003));

  // pão de cima (cúpula)
  const top = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = t * Math.PI / 2;
    top.push(new THREE.Vector2(Math.cos(a) * R * 1.03, Math.sin(a) * 0.042 + (t < 0.05 ? 0 : 0.002)));
  }
  top.unshift(new THREE.Vector2(0, 0), new THREE.Vector2(R * 0.98, 0));
  const pt = new THREE.LatheGeometry(top, 72);
  paint(pt, (x, y, z, c) => {
    const t = y / 0.044;
    c.copy(t < 0.06 ? new THREE.Color(0xf3dcae) : mix(0xe0a95a, 0xa9631f, t * 0.9 + (fbm(x * 70, y * 70, z * 70) - 0.5) * 0.4));
  });
  g.add(mesh(pt, vmat(0.55), 0, base + 0.048, 0));

  // gergelim
  const sg = new THREE.SphereGeometry(0.0022, 8, 6);
  sg.scale(1, 0.45, 1.8);
  const sm = mat(0xf7ecd0, 0.5);
  for (let i = 0; i < 38; i++) {
    const a = rr(0, Math.PI * 2), r = Math.sqrt(rand()) * R * 0.8;
    const h = Math.sqrt(Math.max(0, 1 - (r / (R * 1.03)) ** 2)) * 0.042 + 0.002;
    const s = mesh(sg, sm, Math.cos(a) * r, base + 0.048 + h, Math.sin(a) * r);
    const nrm = new THREE.Vector3(Math.cos(a) * r / (R * R), h / (0.042 * 0.042), Math.sin(a) * r / (R * R)).normalize();
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
    s.rotateY(rr(0, Math.PI));
    g.add(s);
  }

  // algumas batatas ao lado
  batatas(g, 14, -0.085 - 0.03, base, 0.0, 0.05);
  return g;
}

function batatas(group, n, cx, cy, cz, spread) {
  const m = vmat(0.6);
  for (let i = 0; i < n; i++) {
    const L = rr(0.045, 0.075);
    let b = new THREE.BoxGeometry(0.0085, 0.0085, L, 1, 1, 4);
    paint(b, (x, y, z, c) => c.copy(mix(0xf6cf63, 0xd9952c, Math.abs(z) / (L / 2) * 0.8 + rand() * 0.15)));
    const f = mesh(b, m, cx + rr(-spread, spread) * 0.45, cy + 0.005 + rand() * 0.012 + (i > n * 0.6 ? 0.008 : 0), cz + rr(-spread, spread));
    f.rotation.set(rr(-0.15, 0.15), rr(0, Math.PI), rr(-0.3, 0.3));
    group.add(f);
  }
}

// ======================================================
// 2) PIZZA MARGHERITA
// ======================================================
function pizza() {
  const g = new THREE.Group();
  const D = 0.30, R = D / 2;
  g.add(tabuaRedonda(0.34));
  const base = 0.018;

  // massa + borda
  const prof = [];
  prof.push(new THREE.Vector2(0, 0));
  prof.push(new THREE.Vector2(R * 0.9, 0));
  for (let i = 0; i <= 16; i++) {
    const a = -Math.PI / 2 + (i / 16) * Math.PI;
    prof.push(new THREE.Vector2(R * 0.915 + Math.cos(a) * R * 0.085, 0.012 + Math.sin(a) * 0.012));
  }
  prof.push(new THREE.Vector2(R * 0.83, 0.008), new THREE.Vector2(0, 0.008));
  let massa = new THREE.LatheGeometry(prof, 128);
  massa = bumpy(massa, 0.0025, 40);
  paint(massa, (x, y, z, c) => {
    const r = Math.hypot(x, z) / R;
    const n = fbm(x * 50, y * 50, z * 50);
    let col = mix(0xe9bf78, 0xb8732f, (r - 0.82) * 4 + n * 0.5);
    if (r > 0.86 && n > 0.62) col = mix(col, 0x3b2010, (n - 0.62) * 3); // manchas de forno
    c.copy(col);
  });
  g.add(mesh(massa, vmat(0.8), 0, base, 0));

  // molho
  const molho = new THREE.CircleGeometry(R * 0.84, 96);
  molho.rotateX(-Math.PI / 2);
  paint(molho, (x, y, z, c) => c.copy(mix(0x9a1c12, 0xc0321e, fbm(x * 40, 0, z * 40))));
  g.add(mesh(molho, vmat(0.45), 0, base + 0.0085, 0));

  // muçarela (manchas derretidas)
  const mm = vmat(0.5);
  for (let i = 0; i < 11; i++) {
    const a = rr(0, Math.PI * 2), r = Math.sqrt(rand()) * R * 0.62;
    const rad = rr(0.022, 0.034);
    let q = new THREE.SphereGeometry(rad, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    q.scale(1, 0.12, rr(0.8, 1.15));
    q = bumpy(q, 0.003, 60, i * 3);
    paint(q, (x, y, z, c) => c.copy(mix(0xfff6dc, 0xf1d99a, fbm(x * 80 + i, y * 80, z * 80))));
    const m = mesh(q, mm, Math.cos(a) * r, base + 0.0088, Math.sin(a) * r);
    m.rotation.y = rr(0, Math.PI);
    g.add(m);
  }

  // manjericão
  const fm = mat(0x2f7d2a, 0.4, { side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) {
    const a = rr(0, Math.PI * 2), r = rr(0.02, R * 0.7);
    const leaf = new THREE.SphereGeometry(0.014, 16, 8);
    leaf.scale(0.55, 0.12, 1.1);
    const m = mesh(leaf, fm, Math.cos(a) * r, base + 0.0125, Math.sin(a) * r);
    m.rotation.y = rr(0, Math.PI);
    g.add(m);
  }
  // fio de azeite / brilho: um pouco de orégano
  const om = mat(0x5a6b2a, 0.7);
  const og = new THREE.BoxGeometry(0.002, 0.0008, 0.002);
  for (let i = 0; i < 70; i++) {
    const a = rr(0, Math.PI * 2), r = Math.sqrt(rand()) * R * 0.8;
    g.add(mesh(og, om, Math.cos(a) * r, base + 0.0105, Math.sin(a) * r));
  }
  return g;
}

// ======================================================
// 3) BITOQUE (bife, ovo estrelado, batatas e salada)
// ======================================================
function bitoque() {
  const g = new THREE.Group();
  g.add(prato(0.29));
  const base = 0.012;

  // bife (forma irregular extrudada)
  const s = new THREE.Shape();
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = 0.06 * (1 + 0.12 * Math.sin(a * 2 + 0.5) + 0.06 * Math.sin(a * 5));
    pts.push(new THREE.Vector2(Math.cos(a) * r * 1.35, Math.sin(a) * r));
  }
  s.setFromPoints(pts);
  let bife = new THREE.ExtrudeGeometry(s, { depth: 0.011, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 3, curveSegments: 4 });
  bife.rotateX(-Math.PI / 2);
  bife = bumpy(bife, 0.0015, 90);
  paint(bife, (x, y, z, c) => {
    const grill = Math.abs(Math.sin((x + z) * 120)) > 0.93 && y > 0.012 ? 1 : 0;
    c.copy(grill ? new THREE.Color(0x24130a) : mix(0x6a3a1f, 0x8a4f2a, fbm(x * 90, y * 90, z * 90)));
  });
  const bm = mesh(bife, vmat(0.7), 0.025, base + 0.003, 0.02);
  bm.rotation.y = 0.3;
  g.add(bm);

  // ovo estrelado
  const os = new THREE.Shape();
  const opts = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 0.043 * (1 + 0.14 * Math.sin(a * 3 + 1) + 0.07 * Math.sin(a * 7));
    opts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  os.setFromPoints(opts);
  const clara = new THREE.ExtrudeGeometry(os, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.002, bevelSegments: 2, curveSegments: 4 });
  clara.rotateX(-Math.PI / 2);
  paint(clara, (x, y, z, c) => {
    const r = Math.hypot(x, z);
    c.copy(r > 0.038 ? mix(0xf8f3e6, 0xc98b3f, (r - 0.038) * 120) : new THREE.Color(0xfbf8f0));
  });
  g.add(mesh(clara, vmat(0.3), 0.03, base + 0.0195, 0.018));
  const gema = new THREE.SphereGeometry(0.0165, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  gema.scale(1, 0.62, 1);
  g.add(mesh(gema, mat(0xf2a20d, 0.15), 0.036, base + 0.0225, 0.014));

  // batatas fritas
  batatas(g, 22, -0.06, base, -0.035, 0.045);

  // salada: alface + tomate
  const sm = vmat(0.55, { side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) {
    let f = new THREE.SphereGeometry(0.025, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2.4);
    f.scale(1, 0.4, 0.7);
    f = bumpy(f, 0.002, 120, i);
    paint(f, (x, y, z, c) => c.copy(mix(0x4f9a2a, 0xb8de6a, y * 60)));
    const m = mesh(f, sm, -0.075 + rr(-0.015, 0.015), base + 0.004 + i * 0.002, 0.06 + rr(-0.015, 0.015));
    m.rotation.set(rr(-0.4, 0.4), rr(0, Math.PI), rr(-0.4, 0.4));
    g.add(m);
  }
  for (let i = 0; i < 3; i++) {
    const w = new THREE.SphereGeometry(0.017, 16, 10, 0, Math.PI * 0.6, 0, Math.PI);
    paint(w, (x, y, z, c) => c.copy(new THREE.Color(0xd2321f)));
    const m = mesh(w, vmat(0.3, { side: THREE.DoubleSide }), -0.06 + i * 0.013, base + 0.02, 0.05 + rr(-0.01, 0.01));
    m.rotation.set(Math.PI / 2, rr(0, Math.PI), 0);
    g.add(m);
  }
  return g;
}

// ======================================================
// 4) PASTÉIS DE NATA (2 unidades)
// ======================================================
function pasteisDeNata() {
  const g = new THREE.Group();
  g.add(prato(0.17));
  const base = 0.012;

  const tarte = (cx, cz, s) => {
    const R = 0.034, Rb = 0.024, H = 0.021;
    // casca folhada: perfil de copo com estrias horizontais
    const prof = [new THREE.Vector2(0, 0), new THREE.Vector2(Rb, 0)];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      prof.push(new THREE.Vector2(Rb + (R - Rb) * t + Math.sin(t * Math.PI * 7) * 0.0007, H * t));
    }
    prof.push(new THREE.Vector2(R + 0.0015, H + 0.0015), new THREE.Vector2(R - 0.003, H + 0.002), new THREE.Vector2(R - 0.004, H - 0.002));
    let casca = new THREE.LatheGeometry(prof, 64);
    casca = bumpy(casca, 0.0009, 220, cx * 100);
    paint(casca, (x, y, z, c) => c.copy(mix(0xe8b56a, 0x9b5a1d, y / H * 0.7 + fbm(x * 150, y * 150, z * 150) * 0.5)));
    const m1 = mesh(casca, vmat(0.7), cx, base, cz);

    // creme com manchas caramelizadas (lathe com muitos anéis para o ruído aparecer)
    const Rc = R - 0.004;
    const cprof = [];
    for (let i = 0; i <= 24; i++) {
      const r = (i / 24) * Rc;
      cprof.push(new THREE.Vector2(r, (1 - (r / Rc) ** 2) * 0.0035));
    }
    let creme = new THREE.LatheGeometry(cprof.reverse(), 96);
    creme = bumpy(creme, 0.0006, 300, cx * 50);
    paint(creme, (x, y, z, c) => {
      const n = fbm(x * 140 + cx * 30, 1, z * 140);
      const n2 = fbm(x * 400, 3, z * 400);
      let col = mix(0xf3c75a, 0xe3a23c, n * 0.8 + n2 * 0.3);
      if (n > 0.5) col = mix(col, 0x2e1606, (n - 0.5) * 3.2);
      c.copy(col);
    });
    const m2 = mesh(creme, vmat(0.45), cx, base + H - 0.002, cz);
    const grp = new THREE.Group();
    grp.add(m1, m2);
    grp.rotation.y = s;
    return grp;
  };
  g.add(tarte(-0.036, 0.004, 0.2));
  g.add(tarte(0.036, -0.004, 1.3));

  // canela polvilhada num cantinho
  const cm = mat(0x7a4219, 0.9);
  const cg = new THREE.BoxGeometry(0.0012, 0.0005, 0.0012);
  for (let i = 0; i < 60; i++) {
    const a = rr(0, Math.PI * 2), r = Math.sqrt(rand()) * 0.012;
    g.add(mesh(cg, cm, 0.036 + Math.cos(a) * r, base + 0.0225, -0.004 + Math.sin(a) * r));
  }
  return g;
}

// ======================================================
// 5) TAÇA DE GELADO (3 bolas)
// ======================================================
function gelado() {
  const g = new THREE.Group();
  // pires
  g.add(prato(0.16, 0xece6dc));
  const base = 0.012;

  // taça de vidro
  const prof = [
    [0, 0], [0.035, 0], [0.036, 0.003], [0.008, 0.008], [0.0055, 0.012], [0.0055, 0.045],
    [0.012, 0.052], [0.04, 0.066], [0.052, 0.085], [0.054, 0.092], [0.0525, 0.093], [0.05, 0.086],
    [0.038, 0.068], [0.012, 0.056], [0, 0.056],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const taca = new THREE.LatheGeometry(prof, 72);
  g.add(mesh(taca, new THREE.MeshStandardMaterial({ color: 0xdff0f5, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35 }), 0, base, 0));

  // bolas
  const sabores = [
    { c1: 0x5a3220, c2: 0x3b1f12, x: -0.019, y: 0.094, z: 0.006 },  // chocolate
    { c1: 0xf4a7b5, c2: 0xe57c92, x: 0.019, y: 0.094, z: 0.006 },   // morango
    { c1: 0xfcf1d0, c2: 0xf0dda5, x: 0.0, y: 0.114, z: -0.012 },   // baunilha
  ];
  sabores.forEach((s, i) => {
    let b = new THREE.SphereGeometry(0.026, 48, 32);
    b = bumpy(b, 0.0035, 70, i * 10);
    const bp = b.attributes.position;
    for (let k = 0; k < bp.count; k++) if (bp.getY(k) < -0.016) bp.setY(k, -0.016 + (bp.getY(k) + 0.016) * 0.3);
    b.computeVertexNormals();
    paint(b, (x, y, z, c) => {
      let col = mix(s.c1, s.c2, fbm(x * 90 + i, y * 90, z * 90));
      if (i === 2 && fbm(x * 220, y * 220, z * 220) > 0.72) col = new THREE.Color(0x2a1a10); // pintas de baunilha
      c.copy(col);
    });
    g.add(mesh(b, vmat(0.55), s.x, base + s.y, s.z));
  });

  // calda de chocolate escorrendo sobre a baunilha
  let calda = new THREE.SphereGeometry(0.0272, 48, 16, 0, Math.PI * 2, 0, Math.PI * 0.32);
  const kp = calda.attributes.position;
  for (let k = 0; k < kp.count; k++) {
    const a = Math.atan2(kp.getZ(k), kp.getX(k));
    const drip = Math.max(0, Math.sin(a * 5)) ** 3 * 0.009;
    if (kp.getY(k) < 0.026) kp.setY(k, kp.getY(k) - drip);
  }
  calda.computeVertexNormals();
  g.add(mesh(calda, mat(0x3a1a0c, 0.15, { side: THREE.DoubleSide }), 0, base + 0.114, -0.012));

  // bolacha wafer
  const wf = new THREE.BoxGeometry(0.012, 0.075, 0.004, 1, 6, 1);
  paint(wf, (x, y, z, c) => c.copy(mix(0xe4b46a, 0xc78b3d, Math.abs(Math.sin(y * 300)))));
  const w = mesh(wf, vmat(0.7), 0.026, base + 0.128, -0.022);
  w.rotation.set(0.15, 0.4, -0.35);
  g.add(w);

  // cereja
  const cer = new THREE.SphereGeometry(0.0095, 24, 16);
  g.add(mesh(cer, mat(0xb3121b, 0.15), -0.002, base + 0.146, -0.01));
  const cab = new THREE.CylinderGeometry(0.0007, 0.0007, 0.025, 6);
  const cb = mesh(cab, mat(0x4f6b1f, 0.6), 0.002, base + 0.162, -0.01);
  cb.rotation.z = -0.3;
  g.add(cb);

  // folha de hortelã
  const hl = new THREE.SphereGeometry(0.009, 12, 6);
  hl.scale(0.6, 0.12, 1.2);
  const h1 = mesh(hl, mat(0x3f9a3a, 0.4), 0.0, base + 0.112, 0.024);
  h1.rotation.set(0.5, 0.6, 0);
  g.add(h1);
  return g;
}

// ======================================================
const pratos = {
  'hamburguer': hamburguer,
  'pizza-margherita': pizza,
  'bitoque': bitoque,
  'pasteis-de-nata': pasteisDeNata,
  'taca-de-gelado': gelado,
};

const exporter = new GLTFExporter();
const relatorio = {};
for (const [nome, fn] of Object.entries(pratos)) {
  const scene = new THREE.Scene();
  const grupo = fn();
  grupo.name = nome;
  scene.add(grupo);
  scene.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(grupo);
  const size = bb.getSize(new THREE.Vector3());
  relatorio[nome] = { largura_cm: +(size.x * 100).toFixed(1), altura_cm: +(size.y * 100).toFixed(1), profundidade_cm: +(size.z * 100).toFixed(1) };
  const glb = await exporter.parseAsync(scene, { binary: true });
  fs.writeFileSync(path.join(OUT, `${nome}.glb`), Buffer.from(glb));
  console.log(nome, (glb.byteLength / 1024).toFixed(0) + ' KB', relatorio[nome]);
}
fs.writeFileSync(path.join(OUT, 'dimensoes.json'), JSON.stringify(relatorio, null, 2));
