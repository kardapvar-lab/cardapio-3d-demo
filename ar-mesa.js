// AR "Ver na minha mesa" para Android (WebXR + ARCore). Versão estável (a que funcionou no teste em vídeo).
// A versão experimental, com oclusão e diário de diagnóstico, fica em ar-mesa-teste.js (?oclusao ou ?debug).
//
// Como funciona:
//   1. A câmera abre e procura superfícies horizontais (mesa, balcão, chão).
//   2. Um contorno do tamanho real do prato aparece onde o celular aponta.
//   3. Um toque na tela fixa o prato ali (com âncora do ARCore, quando disponível).
//   4. Arrastar o dedo gira o prato. O tamanho é sempre o real: não há zoom.
//   5. "Mudar de lugar" volta para a mira.
//
// No iPhone não existe WebXR: a página usa o Quick Look da Apple (via <model-viewer>).

const T = 'https://cdn.jsdelivr.net/npm/three@0.169.0';

let libs = null;
function carregarLibs() {
  if (!libs) {
    libs = Promise.all([
      import(`${T}/+esm`),
      import(`${T}/examples/jsm/loaders/GLTFLoader.js/+esm`),
      import(`${T}/examples/jsm/environments/RoomEnvironment.js/+esm`),
    ]).then(([THREE, gltf, room]) => ({ THREE, GLTFLoader: gltf.GLTFLoader, RoomEnvironment: room.RoomEnvironment }));
    libs.catch(() => { libs = null; });
  }
  return libs;
}

const modelos = new Map();
function carregarModelo(url) {
  if (!modelos.has(url)) {
    const pr = carregarLibs().then(({ GLTFLoader }) => new GLTFLoader().loadAsync(url));
    pr.catch(() => modelos.delete(url));
    modelos.set(url, pr);
  }
  return modelos.get(url);
}

// Sombra suave de contato, do tamanho da base do prato
function criarSombra(THREE, largura, profundidade) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.42)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const sombra = new THREE.Mesh(
    new THREE.PlaneGeometry(largura * 1.2, profundidade * 1.2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  sombra.rotation.x = -Math.PI / 2;
  sombra.position.y = 0.0015;
  sombra.renderOrder = -1;
  return sombra;
}

// Monta a cena: luzes, o prato apoiado em y = 0 e a sombra. Também usada nos testes.
function montarCena(THREE, RoomEnvironment, renderer, gltf) {
  const cena = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  cena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  cena.environmentIntensity = 0.85;
  cena.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 0.7));
  const sol = new THREE.DirectionalLight(0xffffff, 1.3);
  sol.position.set(0.4, 1, 0.3);
  cena.add(sol);

  const prato = gltf.scene.clone(true);
  const caixa = new THREE.Box3().setFromObject(prato);
  const tamanho = caixa.getSize(new THREE.Vector3());
  const centro = caixa.getCenter(new THREE.Vector3());
  prato.position.set(-centro.x, -caixa.min.y, -centro.z); // centraliza e apoia na superfície

  const giro = new THREE.Group();          // gira com o dedo
  giro.add(prato);
  giro.add(criarSombra(THREE, tamanho.x, tamanho.z));
  const ancora = new THREE.Group();        // posição na mesa
  ancora.add(giro);
  cena.add(ancora);

  // Mira: contorno do tamanho real da base do prato
  const raio = Math.max(tamanho.x, tamanho.z) / 2;
  const mira = new THREE.Group();
  const anel = new THREE.Mesh(
    new THREE.RingGeometry(raio - 0.004, raio, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false })
  );
  const ponto = new THREE.Mesh(
    new THREE.CircleGeometry(0.008, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false })
  );
  mira.add(anel, ponto);
  mira.matrixAutoUpdate = false;
  mira.visible = false;
  cena.add(mira);

  return { cena, pmrem, ancora, giro, mira, tamanho };
}

const suporte = (navigator.xr && navigator.xr.isSessionSupported)
  ? navigator.xr.isSessionSupported('immersive-ar').catch(() => false)
  : Promise.resolve(false);

// Abre a AR. Precisa ser chamada direto do toque no botão (exigência do navegador).
async function iniciar(urlModelo, aoSair) {
  const ui = document.getElementById('ar-ui');
  const dica = document.getElementById('ar-dica');
  const btnMover = document.getElementById('ar-mover');
  const btnSair = document.getElementById('ar-sair');

  ui.hidden = false;
  let sessao;
  try {
    sessao = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'anchors', 'local'],
      domOverlay: { root: ui },
    });
  } catch (erro) {
    ui.hidden = true;
    throw erro;
  }

  let textoAtual = '';
  const mostrar = (t) => { if (t !== textoAtual) { textoAtual = t; dica.textContent = t; } };
  mostrar('A carregar o prato…');
  btnMover.hidden = true;

  let renderer = null;
  let fonteHit = null;
  let ancoraXR = null;
  let pmrem = null;

  const encerrar = () => { try { sessao.end(); } catch (e) { /* já encerrada */ } };
  const naoSelecionar = (e) => e.preventDefault(); // toques nos botões não colocam o prato
  btnSair.addEventListener('beforexrselect', naoSelecionar);
  btnMover.addEventListener('beforexrselect', naoSelecionar);
  btnSair.onclick = encerrar;

  sessao.addEventListener('end', () => {
    if (renderer) renderer.setAnimationLoop(null);
    try { fonteHit && fonteHit.cancel(); } catch (e) { /* ignora */ }
    try { ancoraXR && ancoraXR.delete(); } catch (e) { /* ignora */ }
    if (pmrem) pmrem.dispose();
    if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
    ui.removeEventListener('touchstart', aoTocar);
    ui.removeEventListener('touchmove', aoArrastar);
    btnSair.removeEventListener('beforexrselect', naoSelecionar);
    btnMover.removeEventListener('beforexrselect', naoSelecionar);
    ui.hidden = true;
    btnMover.hidden = true;
    if (aoSair) aoSair();
  });

  let xAnterior = null;
  let colocado = false;
  let giro = null;
  function aoTocar(e) { xAnterior = e.touches[0].clientX; }
  function aoArrastar(e) {
    if (!colocado || xAnterior === null || !giro) return;
    const x = e.touches[0].clientX;
    giro.rotation.y += (x - xAnterior) * 0.012;
    xAnterior = x;
  }
  ui.addEventListener('touchstart', aoTocar, { passive: true });
  ui.addEventListener('touchmove', aoArrastar, { passive: true });

  try {
    const [{ THREE, RoomEnvironment }, gltf] = await Promise.all([carregarLibs(), carregarModelo(urlModelo)]);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    renderer.domElement.style.cssText = 'position:fixed;inset:0;pointer-events:none;';
    document.body.appendChild(renderer.domElement);

    const montagem = montarCena(THREE, RoomEnvironment, renderer, gltf);
    const { cena, ancora, mira } = montagem;
    pmrem = montagem.pmrem;
    giro = montagem.giro;
    ancora.visible = false;
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
    const matriz = new THREE.Matrix4();
    const posCamera = new THREE.Vector3();

    await renderer.xr.setSession(sessao);
    const espacoVisor = await sessao.requestReferenceSpace('viewer');
    fonteHit = await sessao.requestHitTestSource({ space: espacoVisor });

    let ultimoHit = null;

    sessao.addEventListener('select', () => {
      if (colocado || !ultimoHit) return;
      const ref = renderer.xr.getReferenceSpace();
      const pose = ultimoHit.getPose(ref);
      if (!pose) return;
      ancora.position.setFromMatrixPosition(matriz.fromArray(pose.transform.matrix));
      // vira a frente do prato para quem está segurando o celular
      posCamera.setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
      giro.rotation.y = Math.atan2(posCamera.x - ancora.position.x, posCamera.z - ancora.position.z);
      ancora.visible = true;
      mira.visible = false;
      colocado = true;
      btnMover.hidden = false;
      mostrar('Tamanho real · arraste para girar');
      if (ultimoHit.createAnchor) {
        ultimoHit.createAnchor().then((a) => {
          if (colocado) ancoraXR = a; else a.delete();
        }).catch(() => { /* sem âncora: fica na posição do toque */ });
      }
    });

    btnMover.onclick = () => {
      colocado = false;
      try { ancoraXR && ancoraXR.delete(); } catch (e) { /* ignora */ }
      ancoraXR = null;
      ancora.visible = false;
      btnMover.hidden = true;
    };

    mostrar('Aponte a câmera para a mesa e mova o celular devagar');

    renderer.setAnimationLoop((tempo, frame) => {
      if (!frame) return;
      const ref = renderer.xr.getReferenceSpace();
      if (!colocado) {
        let achou = null;
        for (const hit of frame.getHitTestResults(fonteHit)) {
          const pose = hit.getPose(ref);
          // só superfícies horizontais viradas para cima (mesa, balcão)
          if (pose && pose.transform.matrix[5] > 0.75) {
            mira.matrix.fromArray(pose.transform.matrix);
            achou = hit;
            break;
          }
        }
        ultimoHit = achou;
        mira.visible = !!achou;
        mostrar(achou ? 'Toque na tela para pôr o prato aqui' : 'Aponte a câmera para a mesa e mova o celular devagar');
      } else if (ancoraXR && frame.trackedAnchors && frame.trackedAnchors.has(ancoraXR)) {
        const pose = frame.getPose(ancoraXR.anchorSpace, ref);
        if (pose) ancora.position.setFromMatrixPosition(matriz.fromArray(pose.transform.matrix));
      }
      renderer.render(cena, camera);
    });
  } catch (erro) {
    console.error('AR:', erro);
    encerrar();
    throw erro;
  }
}

window.KardapAR = {
  suporte,
  iniciar,
  preCarregar: (url) => { carregarModelo(url).catch(() => {}); },
  _montarCena: montarCena,      // usado só nos testes
  _carregarLibs: carregarLibs,
  _carregarModelo: carregarModelo,
};
