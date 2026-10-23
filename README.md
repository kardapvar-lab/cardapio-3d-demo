# Menu 3D — demonstração

Demo de cardápio digital com pratos em 3D e realidade aumentada (AR) em tamanho real.
5 produtos de exemplo, restaurante fictício "Tasca do Largo".

## O que tem aqui

```
index.html              página do cardápio (HTML + CSS + JS, sem build)
cadastrar.html          cadastro de prato pelo celular (scan → 3D → dados → publicar); sem link no menu
cadastro/lib.js         tratamento dos scans no navegador (ferramentas/modelo.mjs empacotado)
ar-mesa.js              realidade aumentada no Android (WebXR + three.js)
teste-ar.html           página de diagnóstico de AR
produtos.json           dados do restaurante, categorias e produtos
versao.json             versão publicada (a página se recarrega sozinha quando muda)
fotos/*.jpg             fotos dos pratos (lista e ficha)
marca/                  logo Kardap (banner, tela de abertura e rodapé)
modelos/*.glb           scans 3D reais dos pratos, em metros (escala real)
ferramentas/preparar-scans.mjs  baixa os scans reais (Sketchfab) e prepara os modelos
ferramentas/novo-prato.mjs      cadastra um prato escaneado por nós (ver abaixo)
ferramentas/modelo.mjs          tratamento dos scans (recorte, escala real, redução): Node e navegador
ferramentas/modelo-node.mjs     o modelo.mjs no Node (lê e grava do disco, texturas com o sharp)
ferramentas/montar-cadastro.sh  empacota o modelo.mjs em cadastro/lib.js (rodar depois de mexer nele)
ferramentas/previa.mjs          desenha o modelo numa imagem (prévia e foto), sem navegador
ferramentas/pratos/*.json       ficha de cada prato escaneado por nós (dados + ajustes do scan)
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

## Cadastrar um prato pelo celular (iPhone)

Tudo no iPhone, sem computador: abra `https://<seu-usuario>.github.io/cardapio-3d-demo/cadastrar.html`
(a página não tem link no cardápio; guarde nos favoritos ou na tela de início).

1. **Escanear** com o app **Scaniverse** (grátis; no iPhone com LiDAR já sai em tamanho real):
   2 ou 3 voltas devagar em volta do prato (baixa, a 45° e por cima), luz clara e difusa, prato parado
   numa mesa fosca. Abra o scan, exporte em **GLB** e salve em Arquivos.
2. **Modelo 3D:** na página, escolha o arquivo. Ela tira a mesa em volta, centraliza, reduz pro
   celular e mostra o prato em 3D, com as medidas. Se precisar: diâmetro real, recorte, girar a frente.
3. **Foto da lista:** tire uma foto do prato ou use a imagem do próprio 3D.
4. **Dados:** nome, categoria, preço (R$), descrição, peso, ingredientes.
5. **Publicar:** grava modelo, foto e prato no repositório num commit só e carimba a versão (como o
   `versao.py`); em ~1 minuto o GitHub Pages atualiza e o prato aparece. Na primeira vez, em
   "Conexão com o GitHub", cole um token *fine-grained* só deste repositório com permissão
   **Contents: Read and write** (fica guardado só naquele celular).

Na aba **Pratos do cardápio** da mesma página dá pra **editar** um prato (o formulário abre preenchido,
com o modelo e a foto atuais; só sobe de novo o que for trocado, e o endereço `#id` não muda) ou
**excluir** (sai do `produtos.json` junto com o modelo e a foto).

Depois de publicar pelo celular, o repositório no GitHub fica na frente da cópia no computador:
rode `git pull` antes de mexer no projeto por aqui.

## Cadastrar um prato escaneado (pelo computador)

1. **Escanear no celular** com um app de scan 3D (fotogrametria) que exporte **.glb**, por exemplo
   Scaniverse ou KIRI Engine (confira se a versão grátis exporta .glb). iPhone Pro com LiDAR já sai
   em tamanho real; nos outros, informe o diâmetro (passo 3).
   - Luz clara e difusa (sem sol direto nem sombra forte), prato parado numa mesa fosca de cor
     diferente da comida.
   - Dê 2 ou 3 voltas inteiras devagar: uma baixa, uma na altura de 45° e uma por cima.
   - No próprio app, recorte a caixa bem rente ao prato. O que sobrar da mesa a ferramenta tira.
   - Evite vidro, metal brilhante e molho muito espelhado (o scan sai com buracos).
2. **Cadastrar:** copie o .glb pro computador e rode
   ```bash
   cd ferramentas
   npm install @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 @gltf-transform/functions@4.1.1 meshoptimizer@0.22.0 sharp@0.33.5
   node novo-prato.mjs frango-assado ~/Downloads/scan.glb
   ```
   Ele copia o scan pra `ferramentas/scans-originais/`, cria a ficha `ferramentas/pratos/frango-assado.json`,
   trata o modelo (tira a mesa, centraliza, reduz pro celular), grava `modelos/frango-assado.glb`,
   gera `fotos/frango-assado.jpg` a partir do modelo e põe o prato no `produtos.json`.
3. **Conferir e completar:** abra `ferramentas/scans-originais/frango-assado-previa.png` (de cima, de
   frente e na diagonal) e o tamanho que ele imprimiu. Na ficha, preencha nome, categoria, preço,
   descrição, peso e ingredientes. Se precisar:
   - tamanho errado → `"diametro": 0.27` (metros) na última etapa;
   - frente do prato virada → `"giro": 90` (graus);
   - sobra de mesa ou de fundo → uma 2ª etapa `{"recorte": {"cx": 0, "cz": 0, "r": 0.14}, "maiorPeca": true}`
     (círculo que fica, em metros, com o prato já centrado: a prévia de cima ajuda a achar o raio);
   - foto de verdade → ponha em `fotos/frango-assado.jpg` e mude `"fotoAutomatica"` pra `false`.

   Depois rode de novo só com o id: `node novo-prato.mjs frango-assado`.
4. Veja localmente (abaixo) e publique.

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
  "ingredientes": ["..."],
  "destaque": "Mais pedido"
}
```

Esse é o mesmo formato que a API do backend vai devolver depois (ex.: `GET /restaurantes/{id}/cardapio`).
Para trocar o JSON estático pela API, basta mudar a URL do `fetch('produtos.json')` no `index.html`.

## Regerar ou mudar os modelos

Os pratos agora são scans nossos (Scaniverse), sem crédito a dar. Os 5 pratos da primeira demo eram
scans do Sketchfab, licença CC BY 4.0, feitos com o script abaixo: se voltar a usar um modelo assim,
o autor tem que ser creditado no rodapé do `index.html` (a licença exige). O script baixa os originais, recorta o fundo,
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
