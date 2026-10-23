// Cadastra no cardápio um prato que nós escaneamos (app de scan 3D no celular, exportado em .glb).
//
// 1ª vez:  node novo-prato.mjs <id> <scan.glb>
//          copia o scan pra scans-originais/<id>.glb e cria a ficha pratos/<id>.json
// depois:  edite a ficha (nome, preço, descrição...; e o recorte, se a prévia mostrar sobra de mesa)
//          e rode de novo só com o id:  node novo-prato.mjs <id>
//
// Cada rodada trata o scan (modelo.mjs: tira a mesa, põe em escala real, reduz pro celular), grava
// modelos/<id>.glb, desenha scans-originais/<id>-previa.png (de cima, de frente e na diagonal) pra
// conferir, gera fotos/<id>.jpg se não tiver foto e põe/atualiza o prato no produtos.json.
// Precisa das mesmas dependências do preparar-scans.mjs (npm install, ver lá).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { io, etapa, finalizar, resumo } from './modelo-node.mjs';
import { renderizar } from './previa.mjs';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const RAIZ = path.join(AQUI, '..');
const FICHAS = path.join(AQUI, 'pratos');
const SCANS = path.join(AQUI, 'scans-originais');
const PRODUTOS = path.join(RAIZ, 'produtos.json');
const FOTO = 900;           // as fotos do cardápio são quadradas, 900 px

const [id, scanNovo] = process.argv.slice(2);
if (!id || !/^[a-z0-9-]+$/.test(id)) {
  console.error('uso: node novo-prato.mjs <id> [scan.glb]   (id só com letras minúsculas, números e "-", ex.: frango-assado)');
  process.exit(1);
}
const fichaArq = path.join(FICHAS, `${id}.json`);
const scanArq = path.join(SCANS, `${id}.glb`);
const cardapio = JSON.parse(fs.readFileSync(PRODUTOS, 'utf8'));

if (scanNovo) {
  if (!/\.(glb|gltf)$/i.test(scanNovo)) throw new Error('Exporte o scan do app em .glb (ou .gltf)');
  fs.mkdirSync(SCANS, { recursive: true });
  fs.copyFileSync(scanNovo, scanArq);
  if (!fs.existsSync(fichaArq)) {
    fs.mkdirSync(FICHAS, { recursive: true });
    const nome = id.split('-').map((p, i) => (i === 0 ? p[0].toUpperCase() + p.slice(1) : p)).join(' ');
    fs.writeFileSync(fichaArq, JSON.stringify({
      produto: {
        id, nome, categoria: cardapio.categorias[0].id, descricao: '', preco: 0,
        foto: `fotos/${id}.jpg`, modelo: `modelos/${id}.glb`, medida: '', peso_g: null,
        ingredientes: [], destaque: null,
      },
      // fotoAutomatica: true = fotos/<id>.jpg sai do próprio modelo (ponha false ao trocar por uma foto de verdade)
      fotoAutomatica: true,
      // etapas do modelo.mjs; diametro (m) só se o app não exportar em tamanho real
      etapas: [{ tirarMesa: true, maiorPeca: true, reduzir: 'auto' }],
    }, null, 2) + '\n');
    console.log(`Ficha criada: ferramentas/pratos/${id}.json (preencha nome, preço, descrição...)`);
  }
}
if (!fs.existsSync(fichaArq)) throw new Error(`Não tem ficha pra "${id}": rode com o arquivo do scan, node novo-prato.mjs ${id} <scan.glb>`);
if (!fs.existsSync(scanArq)) throw new Error(`Falta o scan ${path.relative(RAIZ, scanArq)}`);
const ficha = JSON.parse(fs.readFileSync(fichaArq, 'utf8'));

// ---------- o modelo
const doc = await io.read(scanArq);
for (const e of ficha.etapas) await etapa(doc, e);
await finalizar(doc, { fecharFundo: ficha.fecharFundo !== false, manterMaterial: !!ficha.manterMaterial });
const modeloArq = path.join(RAIZ, ficha.produto.modelo);
await io.write(modeloArq, doc);
const r = resumo(doc);
const mb = fs.statSync(modeloArq).size / 1e6;
console.log(`${id}: ${r.largura} × ${r.fundo} cm, altura ${r.altura} cm, ${r.triangulos} triângulos, ${mb.toFixed(1)} MB`);

const maior = Math.max(r.largura, r.fundo);
if (maior < 5 || maior > 60) console.warn(`  atenção: ${maior} cm não parece um prato. Se o app não exportou em tamanho real, ponha "diametro" (em metros) na última etapa da ficha.`);
if (r.altura > maior) console.warn('  atenção: o prato está mais alto que largo; o scan pode ter vindo deitado ou com sobra de mesa.');
if (mb > 3) console.warn('  atenção: modelo pesado pro celular; diminua "reduzir" na ficha.');

// ---------- prévia pra conferir (de cima, com a frente embaixo; de frente; na diagonal)
const vistas = await Promise.all([90, 0, 35].map(async (elevacao) =>
  (await renderizar(doc, { elevacao, largura: 480, altura: 480 })).png().toBuffer()));
const previaArq = path.join(SCANS, `${id}-previa.png`);
await sharp({ create: { width: 480 * 3, height: 480, channels: 3, background: '#f6f1e8' } })
  .composite(vistas.map((input, i) => ({ input, left: i * 480, top: 0 }))).png().toFile(previaArq);
console.log(`  prévia: ${path.relative(RAIZ, previaArq)}`);

// ---------- foto da lista (do próprio modelo, até ter uma de verdade)
const fotoArq = path.join(RAIZ, ficha.produto.foto);
if (ficha.fotoAutomatica !== false || !fs.existsSync(fotoArq)) {
  await (await renderizar(doc, { elevacao: 35, largura: FOTO, altura: FOTO })).jpeg({ quality: 85 }).toFile(fotoArq);
  console.log(`  foto: ${ficha.produto.foto} (do modelo)`);
}

// ---------- cardápio
const p = ficha.produto;
if (!p.medida) {
  // do tamanho medido no modelo; fica na ficha, pra poder mudar o texto depois
  p.medida = Math.abs(r.largura - r.fundo) <= 2 ? `Ø ${maior} cm` : `${r.largura} × ${r.fundo} cm`;
  fs.writeFileSync(fichaArq, JSON.stringify(ficha, null, 2) + '\n');
  console.log(`  medida: ${p.medida} (do modelo)`);
}
if (!p.peso_g) console.warn('  atenção: falta peso_g na ficha (na página aparece "—")');
if (!cardapio.categorias.some((c) => c.id === p.categoria))
  console.warn(`  atenção: a categoria "${p.categoria}" não existe (tem: ${cardapio.categorias.map((c) => c.id).join(', ')})`);
if (!p.preco) console.warn('  atenção: o prato está sem preço na ficha');
const i = cardapio.produtos.findIndex((q) => q.id === p.id);
if (i >= 0) cardapio.produtos[i] = p; else cardapio.produtos.push(p);
// mesmo formato que o arquivo já tinha (preço sempre com casa decimal: 11.0)
const texto = JSON.stringify(cardapio, null, 2).replace(/^(\s*"preco": )(\d+)(,?)$/gm, '$1$2.0$3');
fs.writeFileSync(PRODUTOS, texto + '\n');
console.log(`  ${i >= 0 ? 'atualizado' : 'cadastrado'} no produtos.json`);
