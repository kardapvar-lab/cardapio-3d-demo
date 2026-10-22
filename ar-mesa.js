// AR "Ver na minha mesa" para Android (WebXR + ARCore).
//
// Como funciona:
//   1. A câmera abre e procura superfícies horizontais (mesa, balcão, chão).
//   2. Um contorno do tamanho real do prato aparece onde o celular aponta.
//   3. Um toque na tela fixa o prato ali (com âncora do ARCore, quando disponível).
//   4. Arrastar o dedo gira o prato. O tamanho é sempre o real: não há zoom.
//   5. "Mudar de lugar" volta para a mira.
//   6. Oclusão: em celulares com sensor/estimativa de profundidade (ARCore Depth), o que estiver
//      na frente do prato no mundo real (a mão, um copo) esconde a parte do prato que fica atrás.
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

// Oclusão por profundidade: injeta no shader de cada material um teste que descarta o pixel
// do prato quando a profundidade real (medida pelo celular) está mais perto da câmera que o prato.
function aplicarOclusao(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying float vOccDepth;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n  vOccDepth = -mvPosition.z;'
    );
    shader.fragmentShader = [
      'varying float vOccDepth;',
      'uniform sampler2D uOccTex;',
      'uniform mat4 uOccUv;',
      'uniform vec2 uOccTela;',
      'uniform float uOccAtiva;',
      shader.fragmentShader.replace('#include <dithering_fragment>', [
        '#include <dithering_fragment>',
        'if (uOccAtiva > 0.5) {',
        '  vec2 nv = vec2(gl_FragCoord.x / uOccTela.x, 1.0 - gl_FragCoord.y / uOccTela.y);',
        '  vec2 duv = (uOccUv * vec4(nv, 0.0, 1.0)).xy;',
        '  float real = texture2D(uOccTex, duv).r;',
        '  if (real > 0.0 && real < vOccDepth - 0.025) discard;',
        '}',
      ].join('\n')),
    ].join('\n');
  };
  material.customProgramCacheKey = () => 'kardap-oclusao';
  material.needsUpdate = true;
}

function criarOclusao(THREE) {
  const textura = new THREE.DataTexture(new Uint16Array(4), 2, 2, THREE.RedFormat, THREE.HalfFloatType);
  textura.magFilter = textura.minFilter = THREE.LinearFilter;
  const uniforms = {
    uOccTex: { value: textura },
    uOccUv: { value: new THREE.Matrix4() },
    uOccTela: { value: new THREE.Vector2(1, 1) },
    uOccAtiva: { value: 0 },
  };
  let meia = null;
  return {
    uniforms,
    // Atualiza a textura com o mapa de profundidade do quadro (XRCPUDepthInformation)
    atualizar(prof, formato, viewport) {
      const w = prof.width, h = prof.height;
      const bruto = formato === 'float32' ? new Float32Array(prof.data) : new Uint16Array(prof.data);
      if (!meia || meia.length !== w * h) {
        meia = new Uint16Array(w * h);
        uniforms.uOccTex.value.dispose();
        uniforms.uOccTex.value = new THREE.DataTexture(meia, w, h, THREE.RedFormat, THREE.HalfFloatType);
        uniforms.uOccTex.value.magFilter = uniforms.uOccTex.value.minFilter = THREE.LinearFilter;
      }
      const k = prof.rawValueToMeters;
      for (let i = 0; i < meia.length; i++) meia[i] = THREE.DataUtils.toHalfFloat(bruto[i] * k);
      uniforms.uOccTex.value.needsUpdate = true;
      uniforms.uOccUv.value.fromArray(prof.normDepthBufferFromNormView.matrix);
      uniforms.uOccTela.value.set(viewport.z, viewport.w);
      uniforms.uOccAtiva.value = 1;
    },
    desligar() { uniforms.uOccAtiva.value = 0; },
  };
}

// Monta a cena: luzes, o prato apoiado em y = 0 e a sombra. Também usada nos testes.
function montarCena(THREE, RoomEnvironment, renderer, gltf, oclusao) {
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
  const sombra = criarSombra(THREE, tamanho.x, tamanho.z);
  giro.add(sombra);
  if (oclusao) {
    const vistos = new Set();
    prato.traverse((o) => {
      if (!o.isMesh) return;
      // materiais são clonados para não mexer no modelo em cache
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of [].concat(o.material)) if (!vistos.has(m)) { vistos.add(m); aplicarOclusao(m, oclusao.uniforms); }
    });
    aplicarOclusao(sombra.material, oclusao.uniforms);
  }
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
      optionalFeatures: ['dom-overlay', 'anchors', 'local', 'depth-sensing'],
      domOverlay: { root: ui },
      depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] },
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

    if (window.XRWebGLBinding && XRWebGLBinding.prototype.getDepthInformation && !XRWebGLBinding.prototype.__kardap) {
      const original = XRWebGLBinding.prototype.getDepthInformation;
      XRWebGLBinding.prototype.getDepthInformation = function (view) {
        try { return original.call(this, view); } catch (e) { return null; }
      };
      XRWebGLBinding.prototype.__kardap = true;
    }

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    renderer.domElement.style.cssText = 'position:fixed;inset:0;pointer-events:none;';
    document.body.appendChild(renderer.domElement);

    const usaProfundidade = Array.isArray(sessao.enabledFeatures) && sessao.enabledFeatures.includes('depth-sensing')
      && sessao.depthUsage === 'cpu-optimized';
    const oclusao = usaProfundidade ? criarOclusao(THREE) : null;
    const montagem = montarCena(THREE, RoomEnvironment, renderer, gltf, oclusao);
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
      if (oclusao && colocado) {
        const poseVisor = frame.getViewerPose(ref);
        const camXR = renderer.xr.getCamera();
        const vp = camXR.cameras && camXR.cameras[0] && camXR.cameras[0].viewport;
        let prof = null;
        try { prof = poseVisor && frame.getDepthInformation(poseVisor.views[0]); } catch (e) { prof = null; }
        if (prof && vp && vp.z > 0) oclusao.atualizar(prof, sessao.depthDataFormat, vp);
        else oclusao.desligar();
      }
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
  _montarCena: montarCena,      // usados só nos testes
  _criarOclusao: criarOclusao,
  _carregarLibs: carregarLibs,
  _carregarModelo: carregarModelo,
};
