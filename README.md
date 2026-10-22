# Menu 3D — demonstração

Demo de cardápio digital com pratos em 3D e realidade aumentada (AR) em tamanho real.
5 produtos de exemplo, restaurante fictício "Tasca do Largo".

## O que tem aqui

```
index.html              página do cardápio (HTML + CSS + JS, sem build)
ar-mesa.js              realidade aumentada no Android (WebXR + three.js)
teste-ar.html           página de diagnóstico de AR
produtos.json           dados do restaurante, categorias e produtos
versao.json             versão publicada (a página se recarrega sozinha quando muda)
fotos/*.jpg             fotos dos pratos (lista e ficha)
marca/                  logo Kardap (banner, tela de abertura e rodapé)
modelos/*.glb           scans 3D reais dos pratos, em metros (escala real)
ferramentas/preparar-scans.mjs  baixa os scans reais (Sketchfab) e prepara os modelos
ferramentas/versao.py   carimba uma versão nova antes de publicar
.nojekyll               faz o GitHub Pages servir os arquivos como estão
```

- **Visualizador 3D e AR:** [`<model-viewer>`](https://modelviewer.dev) do Google, carregado por CDN.
- **AR em tamanho real ("Ver na minha mesa"):**
  - Android: AR própria em `ar-mesa.js` (WebXR). Uma mira do tamanho real do prato aparece na mesa;
    um toque fixa o prato ali (âncora do ARCore), arrastar gira, e não há zoom.
  - iPhone: Quick Look da Apple, pelo `<model-viewer>` com `ar-scale="fixed"`.
  - Antes de abrir a câmera, os shaders e o modelo são "aquecidos" na placa de vídeo; sem isso,
    celulares mais antigos travavam no primeiro desenho do prato (no toque) e o Android fechava a câmera.
  - Testes: `?oclusao` liga a oclusão por profundidade (experimental); `?debug` mostra o diário da AR
    na tela da câmera. Se a AR travar, o diário aparece sozinho na ficha do prato.
- **Link direto para um prato:** `.../#bitoque` abre a ficha dele. Serve para QR code por prato.

## Publicar uma atualização

```bash
python3 ferramentas/versao.py
git add -A && git commit -m "Descrição da mudança" && git push
```

O `versao.py` troca o número de versão no `index.html` e no `versao.json`. Quem já estiver com o
menu aberto (ou com a página antiga em cache) recarrega sozinho na versão nova ao abrir ou voltar à aba.

## Rodar localmente

```bash
cd cardapio-3d-demo
python3 -m http.server 8000
# abra http://localhost:8000
```

Abrir o `index.html` direto do disco (file://) não funciona: o navegador bloqueia o `fetch` do JSON e dos modelos.

## Testar a AR no celular (GitHub Pages)

AR só funciona em HTTPS, por isso o jeito mais rápido é o GitHub Pages:

1. Crie um repositório `cardapio-3d-demo` e envie esta pasta.
2. No repositório: Settings → Pages → Branch `main`, pasta `/ (root)` → Save.
3. Em ~1 minuto fica em `https://<seu-usuario>.github.io/cardapio-3d-demo/`.
4. Abra no celular, toque num prato e depois em **Ver na minha mesa**.
   No computador, a ficha mostra um QR code para abrir no celular.

## Formato dos produtos

Cada produto em `produtos.json`:

```json
{
  "id": "bitoque",
  "nome": "Bitoque da Casa",
  "categoria": "pratos",
  "descricao": "...",
  "preco": 12.5,
  "modelo": "modelos/bitoque.glb",
  "medida": "Prato Ø 29 cm",
  "peso_g": 380,
  "kcal": 790,
  "ingredientes": ["..."],
  "alergenos": ["Ovo"],
  "destaque": "Mais pedido"
}
```

Esse é o mesmo formato que a API do backend vai devolver depois (ex.: `GET /restaurantes/{id}/cardapio`).
Para trocar o JSON estático pela API, basta mudar a URL do `fetch('produtos.json')` no `index.html`.

## Regerar ou mudar os modelos

Os 5 pratos são scans reais (fotogrametria) do Sketchfab, licença CC BY 4.0: os autores estão
creditados no rodapé do `index.html` (a licença exige). O script baixa os originais, recorta o fundo,
põe em escala real, reduz triângulos e texturas e troca o material "unlit" do scan por um normal
(o Quick Look do iPhone ignora malhas unlit). Resultado: 1,0 a 2,6 MB por prato.

```bash
cd ferramentas
npm install @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 \
  @gltf-transform/functions@4.1.1 meshoptimizer@0.22.0 sharp@0.33.5
SKETCHFAB_TOKEN=... node preparar-scans.mjs ../modelos
```

O token fica em sketchfab.com → Settings → Password & API. Para trocar um prato, mude a lista
`PRATOS` no começo do script (id do modelo no Sketchfab e as etapas de recorte/escala).
As fotos em `fotos/` são renders desses modelos, 900×900, no mesmo ângulo da ficha (30°, 62°).

Para o produto real, o restaurante envia um `.glb` (fotogrametria/scan 3D do prato) no cadastro.
Regra importante: **1 unidade = 1 metro**, senão a AR mostra o prato no tamanho errado.

## Próximos passos (fora deste demo)

- Painel do restaurante: cadastro de produtos e upload do `.glb`
- Backend (Python) com banco de dados e API do cardápio
- Vários restaurantes (multi-tenant), cada um com seu endereço/QR
- Otimização dos modelos (compressão Draco/Meshopt) para carregar rápido no 4G
