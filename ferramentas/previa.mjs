// Desenha um modelo (já tratado por modelo.mjs) numa imagem, sem navegador: serve pra conferir o
// recorte, a escala e qual lado está de frente, e de foto do prato quando não tiver uma de verdade.
// Projeção ortográfica com a textura e uma luz simples vinda de cima e da câmera.
import sharp from 'sharp';

const Borda = 0.02; // folga do teste de dentro-do-triângulo, em fração do triângulo

// elevacao: 90 = de cima (a frente do prato fica embaixo na imagem), 0 = de frente, 35 = três-quartos
export async function renderizar(doc, { elevacao = 35, largura = 800, altura = 600, fundo = [246, 241, 232] } = {}) {
  const e = (elevacao * Math.PI) / 180, cos = Math.cos(e), sen = Math.sin(e);
  const ver = ([x, y, z]) => [x, y * cos - z * sen, y * sen + z * cos]; // [direita, cima, perto]

  const triangulos = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const material = p.getMaterial();
      const tex = material?.getBaseColorTexture();
      const cor = material?.getBaseColorFactor() ?? [1, 1, 1, 1];
      const duplaFace = material ? material.getDoubleSided() : true; // face única: só desenha de frente (ex.: tampa do fundo)
      let imagem = null;
      if (tex) {
        const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
        imagem = { data, w: info.width, h: info.height };
      }
      const pos = p.getAttribute('POSITION'), uv = p.getAttribute('TEXCOORD_0');
      const ind = p.getIndices().getArray(), v = [0, 0, 0], t = [0, 0];
      const pontos = [], uvs = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v); pontos.push(ver(v));
        if (uv) { uv.getElement(i, t); uvs.push([t[0], t[1]]); }
      }
      for (let i = 0; i < ind.length; i += 3) triangulos.push({ k: [ind[i], ind[i + 1], ind[i + 2]], pontos, uvs, imagem, cor, duplaFace });
    }
  }

  // enquadra com folga
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const { k, pontos } of triangulos) for (const j of k) {
    const [x, y] = pontos[j];
    xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
  }
  const escala = 0.88 * Math.min(largura / (xMax - xMin), altura / (yMax - yMin));
  const ox = largura / 2 - escala * (xMin + xMax) / 2, oy = altura / 2 + escala * (yMin + yMax) / 2;
  const tela = ([x, y, z]) => [ox + x * escala, oy - y * escala, z];

  const px = Buffer.alloc(largura * altura * 3);
  for (let i = 0; i < largura * altura; i++) px.set(fundo, i * 3);
  const prof = new Float32Array(largura * altura).fill(-Infinity);

  for (const { k, pontos, uvs, imagem, cor, duplaFace } of triangulos) {
    const [a, b, c] = k.map((j) => tela(pontos[j]));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    // luz: normal no espaço da câmera contra uma luz de cima e um pouco da frente
    const [pa, pb, pc] = k.map((j) => pontos[j]);
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n) || 1;
    if (!duplaFace && n[2] <= 0) continue; // de costas para a câmera
    const luz = 0.55 + 0.45 * Math.abs((n[1] * 0.6 + n[2] * 0.8) / l);

    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(largura - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(altura - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const qx = x + 0.5, qy = y + 0.5;
        const l0 = ((b[0] - qx) * (c[1] - qy) - (b[1] - qy) * (c[0] - qx)) / area;
        const l1 = ((c[0] - qx) * (a[1] - qy) - (c[1] - qy) * (a[0] - qx)) / area;
        const l2 = 1 - l0 - l1;
        if (l0 < -Borda || l1 < -Borda || l2 < -Borda) continue; // (a folga fecha as frestas entre vizinhos)
        const z = l0 * a[2] + l1 * b[2] + l2 * c[2], i = y * largura + x;
        if (z <= prof[i]) continue;
        prof[i] = z;
        let rgb = [cor[0] * 255, cor[1] * 255, cor[2] * 255];
        if (imagem && uvs.length) {
          const s = l0 * uvs[k[0]][0] + l1 * uvs[k[1]][0] + l2 * uvs[k[2]][0];
          const t = l0 * uvs[k[0]][1] + l1 * uvs[k[1]][1] + l2 * uvs[k[2]][1];
          const tx = Math.min(imagem.w - 1, Math.floor((((s % 1) + 1) % 1) * imagem.w));
          const ty = Math.min(imagem.h - 1, Math.floor((((t % 1) + 1) % 1) * imagem.h));
          const q = (ty * imagem.w + tx) * 4;
          rgb = [imagem.data[q] * cor[0], imagem.data[q + 1] * cor[1], imagem.data[q + 2] * cor[2]];
        }
        px[i * 3] = Math.min(255, rgb[0] * luz); px[i * 3 + 1] = Math.min(255, rgb[1] * luz); px[i * 3 + 2] = Math.min(255, rgb[2] * luz);
      }
    }
  }
  return sharp(px, { raw: { width: largura, height: altura, channels: 3 } });
}
