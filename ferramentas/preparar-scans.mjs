// Baixa os scans reais dos pratos (Sketchfab, CC BY 4.0) e prepara para o cardápio (modelo.mjs).
//
// Uso: cd ferramentas && npm install @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 \
//        @gltf-transform/functions@4.1.1 meshoptimizer@0.22.0 sharp@0.33.5
//      SKETCHFAB_TOKEN=... node preparar-scans.mjs ../modelos
// O token fica em sketchfab.com → Settings → Password & API. Os créditos estão no rodapé do index.html.
// Pra um prato escaneado por nós, use novo-prato.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { io, etapa, finalizar, resumo } from './modelo-node.mjs';

// Cada prato passa pelas etapas em ordem (ver modelo.mjs).
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

for (const prato of PRATOS) {
  const original = path.join(CACHE, `${prato.arquivo}.glb`);
  await baixar(prato.uid, token, original);
  const doc = await io.read(original);
  for (const e of prato.etapas) await etapa(doc, e);
  await finalizar(doc);
  await io.write(path.join(SAIDA, `${prato.arquivo}.glb`), doc);
  const r = resumo(doc);
  console.log(`${prato.arquivo}: ${r.largura} × ${r.fundo} cm, altura ${r.altura} cm, ${r.triangulos} triângulos (scan de ${prato.autor})`);
}
