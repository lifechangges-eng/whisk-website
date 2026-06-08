/* ============================================================
   WHISK · scene.js (ES module · Three.js r160)
   ============================================================
   3 scenes:
     · HeroScene   — page top, 6 product 3D models floating + mouse parallax
     · BakeScene   — 5-stage cinematic scroll sequence with real GLB models
     · AboutScene  — procedural polished whisk in the About section
   ----------------------------------------------------------------------
   Uses optimized .glb models (~1.6 MB avg, meshopt-compressed)
   loaded with GLTFLoader + MeshoptDecoder.
============================================================ */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/* ------------------------------------------------------------
   Brand palette (Guía 2 FASE 0A) — sin azules, sin blancos puros
------------------------------------------------------------ */
const CREAM = 0xF5F0E6;
const WARM  = 0xFAF7F0;
const BLACK = 0x0A0A0A;   // negro profundo (era #1A1C20)
const BEIGE = 0xC8B89A;   // acento cálido
const HONEY = 0xc88a3a;
// Luz rim cálida (reemplaza las azules 0xc4d3ff / 0xb6c8ff)
const RIM_WARM = 0xf3d9b3;

/* ------------------------------------------------------------
   Math utils
------------------------------------------------------------ */
const lerp     = (a,b,t) => a + (b-a)*t;
const clamp    = (v,a,b) => Math.max(a, Math.min(b,v));
const easeOut  = t => 1 - Math.pow(1-t, 3);
const easeIn   = t => t*t*t;
const easeInOut= t => t<0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
const rnd      = (a=1,b) => b===undefined ? Math.random()*a : a + Math.random()*(b-a);

/* ------------------------------------------------------------
   Performance helpers (Guía 2 FASE 0B)
------------------------------------------------------------ */
const IS_MOBILE = matchMedia('(hover:none) and (pointer:coarse)').matches
                 || matchMedia('(max-width: 880px)').matches;
// Pixel-ratio cap: 1.5 para evitar 4K render en pantallas retina
const PIXEL_RATIO_CAP = IS_MOBILE ? 1 : 1.5;
// 60fps target — saltamos frames si llegaron antes de 16ms
const FRAME_MIN_MS = 1000 / 60;

/* ============================================================
   STUDIO ENV MAP (procedural IBL — soft warm key + dark base)
============================================================ */
function makeStudioEnvMap(renderer) {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0,   '#fef6e6');
  g.addColorStop(0.42,'#c8a878');
  g.addColorStop(0.55,'#3a2818');
  g.addColorStop(1,   '#0a0805');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = 'lighter';
  [
    {x:W*0.18, y:H*0.32, r:200, c:'rgba(255,250,235,0.75)'},
    {x:W*0.5,  y:H*0.12, r:280, c:'rgba(255,244,220,0.65)'},
    {x:W*0.82, y:H*0.35, r:170, c:'rgba(255,248,230,0.55)'},
    {x:W*0.35, y:H*0.5,  r:120, c:'rgba(255,230,195,0.4)'},
  ].forEach(L => {
    const r = x.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
    r.addColorStop(0, L.c);
    r.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = r;
    x.fillRect(0, 0, W, H);
  });

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envTex = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return envTex;
}

function makeSoftSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0,   'rgba(245,240,230,1)');
  g.addColorStop(0.5, 'rgba(245,240,230,0.55)');
  g.addColorStop(1,   'rgba(245,240,230,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ============================================================
   GEOMETRY POST-PROCESS
   Crop the bottom N% of a mesh's triangles — removes the "plate /
   pedestal / fork" that Tripo3D often bundles under the product.
============================================================ */
function cropBottom(mesh, cropRatio = 0.22) {
  const geo = mesh.geometry;
  if (!geo || !geo.attributes.position) return;
  const pos = geo.attributes.position;

  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cropY = minY + (maxY - minY) * cropRatio;

  const idx = geo.index;
  if (!idx) return; // non-indexed: skip
  const arr = idx.array;
  const kept = [];
  for (let t = 0; t < arr.length; t += 3) {
    const a = arr[t], b = arr[t+1], c = arr[t+2];
    // Keep triangle if its TOP vertex is above the crop line
    if (Math.max(pos.getY(a), pos.getY(b), pos.getY(c)) > cropY) {
      kept.push(a, b, c);
    }
  }
  geo.setIndex(kept);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.computeVertexNormals();
}

/* ============================================================
   MODEL MANAGER — single loader with cache, instanced clones
============================================================ */
class ModelManager {
  constructor() {
    this.loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    draco.preload();
    this.loader.setDRACOLoader(draco);
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.cache = new Map();
  }

  /** Load a glb and return its prepared scene Group.
   *  options.cropPlate: number 0..1 — crops bottom N of mesh height
   */
  async load(url, options = {}) {
    if (this.cache.has(url)) return this.cache.get(url);
    const gltf = await this.loader.loadAsync(url);
    const root = gltf.scene;
    root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material) {
          o.material.envMapIntensity = 1.0;
        }
        if (options.cropPlate) cropBottom(o, options.cropPlate);
        // PASS 4 — neutralize pink/rose on petalos model → warm champagne gold
        // Prevents pink halo from contaminating scene atmosphere / additive particles
        if (url.includes('petalos')) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => {
            if (!m.color) return;
            const { r, g, b } = m.color;
            // Pink signature: red-dominant, meaningful blue, red clearly above green
            if (r > 0.40 && (r - g) > 0.04 && b > 0.08) {
              m.color.setHex(0xd4a068);        // warm caramel-gold — premium, brand-safe
              if (m.emissive) m.emissive.setHex(0x060300);
              m.roughness = Math.max(m.roughness ?? 0.5, 0.55);
            }
          });
        }
      }
    });
    this.cache.set(url, root);
    return root;
  }

  /** Return a normalized, ready-to-place wrapper.
   *  Inner mesh is centered + scaled so the max dimension == targetSize.
   *  You manipulate the wrapper's position/rotation/scale freely. */
  instance(url, targetSize = 1.0) {
    const original = this.cache.get(url);
    if (!original) throw new Error('Model not loaded: ' + url);
    const inner = original.clone(true);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = targetSize / maxDim;
    inner.position.set(-center.x, -center.y, -center.z);
    const wrapper = new THREE.Group();
    wrapper.add(inner);
    wrapper.scale.setScalar(scale);
    return wrapper;
  }

  /** Load many; report progress via callback.
   *  urls can be ['url1', 'url2'] OR [{ url, options }, ...]
   */
  async loadAll(urls, onProgress) {
    const total = urls.length;
    let done = 0;
    await Promise.all(urls.map(async u => {
      if (typeof u === 'string') await this.load(u);
      else                       await this.load(u.url, u.options);
      done++;
      onProgress?.(done, total);
    }));
  }
}

const modelManager = new ModelManager();

/* Model URLs (semantic) */
const M = {
  brownie:      './assets/assetsmodelos-3d/optimizados/brownie.glb',
  melokis:      './assets/assetsmodelos-3d/optimizados/melokis.glb',
  tejas:        './assets/assetsmodelos-3d/optimizados/tejas.glb',
  mille:        './assets/assetsmodelos-3d/optimizados/mille-feuille.glb',
  petalos:      './assets/assetsmodelos-3d/optimizados/petalos-rosa.glb',
  barba:        './assets/assetsmodelos-3d/optimizados/barba-dragon.glb',
  // Cotton ball SIN OPTIMIZAR (no existe versión en optimizados/) — Corrección 9/10
  cotton:       './assets/assetsmodelos-3d/cotton+ball+3d+model.glb',
  nuez:         './assets/assetsmodelos-3d/optimizados/nuez.glb',
  ingredientes: './assets/assetsmodelos-3d/optimizados/ingredientes.glb',
  batidora:     './assets/assetsmodelos-3d/optimizados/batidora.glb',
  horno:        './assets/assetsmodelos-3d/optimizados/horno.glb',
  bandeja:      './assets/assetsmodelos-3d/optimizados/bandeja-brownies.glb',
  cuchara:      './assets/assetsmodelos-3d/optimizados/cuchara.glb',
};

/* ============================================================
   PROCEDURAL INGREDIENT BUILDERS
   For Stage 2: egg, flour stream, butter cube, sugar stream
============================================================ */
function buildProcEgg() {
  const grp = new THREE.Group();
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: 0xfaf2dc, roughness: 0.55, metalness: 0,
    clearcoat: 0.3, clearcoatRoughness: 0.5,
  });
  const yolkMat = new THREE.MeshPhysicalMaterial({
    color: 0xe8a83d, roughness: 0.15, metalness: 0,
    clearcoat: 0.95, clearcoatRoughness: 0.08,
  });
  const whiteMat = new THREE.MeshPhysicalMaterial({
    color: 0xfffce8, roughness: 0.3, metalness: 0,
    clearcoat: 0.7, clearcoatRoughness: 0.2,
    transmission: 0.5, transparent: true, opacity: 0.6, ior: 1.35,
  });
  const whole = new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 24), shellMat);
  whole.scale.set(1, 1.32, 1);
  const half1 = new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 24, 0, Math.PI), shellMat);
  half1.scale.set(1, 1.32, 1); half1.visible = false;
  const half2 = half1.clone(); half2.rotation.y = Math.PI;
  const yolk = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 18), yolkMat);
  yolk.visible = false;
  const white = new THREE.Mesh(new THREE.SphereGeometry(0.20, 24, 16), whiteMat);
  white.scale.set(1.4, 0.3, 1.4); white.visible = false;
  grp.add(whole, half1, half2, yolk, white);
  grp.userData = { whole, half1, half2, yolk, white };
  return grp;
}

function buildButter() {
  const geo = new THREE.BoxGeometry(0.42, 0.22, 0.28, 6, 4, 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) + (Math.random()-0.5) * 0.008);
    pos.setY(i, pos.getY(i) + (Math.random()-0.5) * 0.008);
    pos.setZ(i, pos.getZ(i) + (Math.random()-0.5) * 0.008);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xf6cf5f, roughness: 0.5, metalness: 0,
    clearcoat: 0.45, clearcoatRoughness: 0.35,
    transmission: 0.08, ior: 1.45, thickness: 0.25,
  });
  return new THREE.Mesh(geo, mat);
}

function buildFlourBag() {
  // Folded paper bag — procedural cone/cylinder
  const grp = new THREE.Group();
  const bagMat = new THREE.MeshPhysicalMaterial({
    color: 0xf0e6cf, roughness: 0.85, metalness: 0,
  });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.42, 0.95, 12, 4),
    bagMat
  );
  // Squish top to mimic folded paper
  const pos = body.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0.3) {
      pos.setX(i, pos.getX(i) * 0.5);
      pos.setZ(i, pos.getZ(i) * 0.5);
    }
  }
  body.geometry.computeVertexNormals();
  grp.add(body);
  // Tilted ready-to-pour orientation
  grp.rotation.z = Math.PI * 0.35;
  return grp;
}

function buildFlourStream() {
  // Tapered white cylinder — the falling flour column
  const geo = new THREE.CylinderGeometry(0.04, 0.12, 1.0, 12, 8, true);
  geo.translate(0, -0.5, 0); // pivot at top
  const mat = new THREE.MeshBasicMaterial({
    color: 0xfaf3df, transparent: true, opacity: 0.65, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

/* ============================================================
   Guía 2 FASE 2 STAGE 2 — Bowl procedural centrado en escena
   Hemisferio inferior (cuenco) + aro fino arriba.
   El "rim" queda en y=0; el fondo del bowl en y=-1.
============================================================ */
function buildBowl(radius = 1.0) {
  const grp = new THREE.Group();
  const bowlMat = new THREE.MeshPhysicalMaterial({
    color: 0xe8dfc8,        // cerámica crema
    roughness: 0.45, metalness: 0.05,
    clearcoat: 0.55, clearcoatRoughness: 0.25,
    side: THREE.DoubleSide,  // ver interior + exterior
  });
  // Hemisferio inferior (de ecuador a polo sur)
  const bowlGeo = new THREE.SphereGeometry(
    radius, 48, 32, 0, Math.PI*2, Math.PI*0.5, Math.PI*0.5
  );
  const bowl = new THREE.Mesh(bowlGeo, bowlMat);
  grp.add(bowl);
  // Aro del borde
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius*0.045, 14, 64),
    bowlMat
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0;
  grp.add(rim);
  return grp;
}

/* Guía 2 FASE 2 STAGE 2 — Hilo de miel dorado (cilindro semi-transparente) */
function buildHoneyStream() {
  const geo = new THREE.CylinderGeometry(0.035, 0.05, 1.0, 12, 8, true);
  geo.translate(0, -0.5, 0); // pivote arriba
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xd99a2a, roughness: 0.12, metalness: 0.0,
    clearcoat: 0.9, clearcoatRoughness: 0.05,
    transmission: 0.35, ior: 1.45, thickness: 0.3,
    transparent: true, opacity: 0.85, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

/* Whisk procedural builder (for the AboutScene — no GLB needed) */
function buildWhiskMesh(scale = 1) {
  const grp = new THREE.Group();
  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0xf8f6f0, roughness: 0.08, metalness: 1.0,  // warm neutral, no blue tint
    clearcoat: 0.6, clearcoatRoughness: 0.08,
  });
  const chromeDark = new THREE.MeshPhysicalMaterial({
    color: 0xe8e0d0, roughness: 0.12, metalness: 1.0,  // warm neutral chrome
    clearcoat: 0.5, clearcoatRoughness: 0.1,
  });
  const handlePoints = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const y = t * 1.5;
    const r = 0.085 + Math.sin(t * Math.PI) * 0.018 + (1 - t) * 0.04;
    handlePoints.push(new THREE.Vector2(r, y));
  }
  const handle = new THREE.Mesh(new THREE.LatheGeometry(handlePoints, 48), chrome);
  handle.position.y = -0.05;
  grp.add(handle);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 24), chrome);
  cap.position.y = 1.45;
  cap.scale.set(1, 0.7, 1);
  grp.add(cap);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.022, 12, 36), chromeDark);
  bezel.position.y = -0.06;
  bezel.rotation.x = Math.PI / 2;
  grp.add(bezel);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.05, 0),
      new THREE.Vector3(Math.cos(a)*0.20, -0.18, Math.sin(a)*0.20),
      new THREE.Vector3(Math.cos(a)*0.45, -0.55, Math.sin(a)*0.45),
      new THREE.Vector3(Math.cos(a)*0.52, -0.95, Math.sin(a)*0.52),
      new THREE.Vector3(Math.cos(a)*0.34, -1.18, Math.sin(a)*0.34),
      new THREE.Vector3(0, -1.25, 0),
    ]);
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.022, 12, false), chrome);
    grp.add(wire);
  }
  grp.scale.setScalar(scale);
  return grp;
}

/* ============================================================
   HERO SCENE — 6 product GLB models floating with mouse parallax
   ============================================================
   Per WHISK-GUIA section 4D: "En el HERO: los productos
   confirmados, como objetos 3D girando lento, flotando a
   distintas profundidades, con parallax de mouse."
============================================================ */
export class HeroScene {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    // Guía 2 FASE 1 — SIN mouse parallax. No guardamos posición del mouse.
    this.time = 0;
    this.scrollProgress = 0;
    this.onProgress = opts.onProgress || (()=>{});
    this.products = [];
    this.ready = this.init();
  }

  async init() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: !IS_MOBILE, alpha: true,
      powerPreference: 'high-performance'
    });
    // Guía 2 FASE 0B — capar pixel ratio (1.5 desktop, 1 mobile)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 2.2;
    // Sombras OFF en mobile (Guía 2 FASE 0B)
    this.renderer.shadowMap.enabled = !IS_MOBILE;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0d0f15, 6, 24); // CREATIVE DIR — warm deep navy, no pure black void
    this.scene.environment = makeStudioEnvMap(this.renderer);

    this.camera = new THREE.PerspectiveCamera(42, w/h, 0.1, 100);
    this.camera.position.set(0, 0.4, 9);
    this.camera.lookAt(0, 0, 0);

    this.addLights();
    this.addParticles();

    // Hero: 5 productos WHISK confirmados en composición orbital
    // CURATION — cotton+ball.glb removed: non-baking prop with zero brand relevance.
    //   Negative space behind the WHISK title is more premium than a filler cloud.
    const heroUrls = [
      { url: M.brownie, options: { cropPlate: 0.34 } },
      { url: M.melokis, options: { cropPlate: 0.18 } },
      { url: M.tejas,   options: { cropPlate: 0.20 } },
      { url: M.mille,   options: { cropPlate: 0.22 } },
      { url: M.petalos, options: { cropPlate: 0.42 } },
    ];
    await modelManager.loadAll(heroUrls, this.onProgress);
    this.addProducts([M.brownie, M.melokis, M.tejas, M.mille, M.petalos]);

    this.bind();
    this.tick();
  }

  /** Nube COTTON-BALL detrás de la W del logo WHISK (Corrección 9/10).
   *  Modelo cotton+ball+3d+model.glb (sin optimizar — esponjoso, blanco natural).
   *  Posición: detrás-izquierda (la W es la primera letra del título centrado).
   *  Tamaño: ligeramente más grande que la W. Opacidad 0.7. Color blanco/crema.
   *  Float senoidal suave. SIN mouse parallax. */
  addDecorativeCloud() {
    const cloud = modelManager.instance(M.cotton, 3.2);
    // Detrás de la W (primer carácter del título centrado → x negativo)
    cloud.position.set(-2.6, 0.1, -2.4);
    cloud.rotation.y = 0.3;
    cloud.userData = { isCloud: true, baseY: 0.1, baseX: -2.6 };
    // Materiales: tintar a CREMA (#F5F0E6, NO blanco puro), opacidad 0.7, efecto esponjoso
    cloud.traverse(o => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        if (o.material.color) o.material.color.setHex(CREAM);
        if ('emissive' in o.material) o.material.emissive?.setHex?.(0x4a3a28);
        if ('roughness' in o.material) o.material.roughness = 1.0;
        if ('metalness' in o.material) o.material.metalness = 0.0;
        o.material.transparent = true;
        o.material.opacity = 0.7;
        o.material.depthWrite = false;
      }
    });
    this.scene.add(cloud);
    this.cloud = cloud;
  }

  addLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.8));
    const key = new THREE.DirectionalLight(0xfff5e0, 2.4);
    key.position.set(5, 8, 6);
    // Rim cálido (antes era azul 0xc4d3ff — Guía 2 prohíbe azules)
    const rim = new THREE.DirectionalLight(RIM_WARM, 1.2);
    rim.position.set(-6, 2, -4);
    const fill = new THREE.PointLight(0xffd9a8, 30, 22);
    fill.position.set(0, 0, 5);
    // Nueva luz cálida frontal-superior — ilumina los productos de frente
    const front = new THREE.DirectionalLight(0xFFE8C0, 1.5);
    front.position.set(0, 6, 8);
    this.scene.add(key, rim, fill, front);
  }

  addProducts(urls) {
    // Guía 2 FASE 1 — 5 productos WHISK. TARGET_SIZE = 1.4. Cámara fija en tick().
    // CURATION — radius 3.6→4.2: more editorial breathing room between products.
    const TARGET_SIZE = 1.4;
    urls.forEach((url, i) => {
      const mesh = modelManager.instance(url, TARGET_SIZE);
      const angle = (i / urls.length) * Math.PI * 2;
      const radius = 4.2;                   // wider orbit — negative space is premium
      mesh.position.set(
        Math.cos(angle) * radius,
        Math.sin(i * 1.3) * 0.55,          // subtle vertical variation
        Math.sin(angle) * radius * 0.7 - 1.2  // compressed depth: products stay readable
      );
      mesh.rotation.set(rnd(0, Math.PI*2), rnd(0, Math.PI*2), rnd(0, Math.PI*2));
      mesh.userData = {
        baseY: mesh.position.y,
        baseX: mesh.position.x,
        baseZ: mesh.position.z,
        floatSpeed: 0.26 + i * 0.03,  // POLISH — 0.40→0.26: 24s float cycle vs 16s (imperceptible drift)
        floatAmp:   0.15,              // POLISH — 0.24→0.15: 38% less vertical travel (cinematic restraint)
        spinSpeed:  0.08 * (i % 2 === 0 ? 1 : -1), // POLISH — 0.14→0.08: slow meditation, not a top
      };
      this.scene.add(mesh);
      this.products.push(mesh);
    });
  }

  addParticles() {
    // CURATION — 1200→480: atmospheric flour dust haze, not a confetti field.
    // Fewer particles + lower opacity = luxury atmosphere. More = visual noise.
    const count = 480;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i*3]   = rnd(-14, 14);
      positions[i*3+1] = rnd(-8, 8);
      positions[i*3+2] = rnd(-14, 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.036, sizeAttenuation: true, transparent: true,
      depthWrite: false, opacity: 0.28, map: makeSoftSprite(),
      blending: THREE.AdditiveBlending, color: CREAM,
    });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  bind() {
    this._onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.camera.aspect = w/h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    // Guía 2 FASE 1 — NO listener de pointermove (sin mouse parallax).
    window.addEventListener('resize', this._onResize, { passive: true });
  }

  setScroll(p) { this.scrollProgress = p; }
  // FASE 10 — pause rendering when hero section is off-screen
  setHeroVisible(v) { this._heroVisible = !!v; }

  tick(now = 0) {
    this._raf = requestAnimationFrame(t => this.tick(t));
    // Guía 2 FASE 0B — suspender cuando la pestaña está oculta
    if (document.hidden) return;
    // FASE 10 — skip render when hero section is off viewport
    if (this._heroVisible === false) return;
    // Throttle a 60fps
    if (this._lastFrame && (now - this._lastFrame) < FRAME_MIN_MS) return;
    this._lastFrame = now;
    const dt = 0.016;
    this.time += dt;

    // Camera completely STILL (no mouse parallax — models float on their own)
    this.camera.position.set(0, 0.4, 9);
    this.camera.lookAt(0, 0, 0);

    const s = this.scrollProgress;

    // Decorative cloud behind W logo: gentle drift, never tracks mouse
    if (this.cloud) {
      const u = this.cloud.userData;
      this.cloud.rotation.y = Math.sin(this.time * 0.09) * 0.10 + 0.3; // POLISH — slower, tighter rotation
      this.cloud.rotation.z = Math.cos(this.time * 0.06) * 0.04;
      this.cloud.position.y = u.baseY + Math.sin(this.time * 0.28) * 0.11; // POLISH — gentler drift
      this.cloud.position.x = u.baseX + Math.cos(this.time * 0.22) * 0.08;
      this.cloud.position.z = -2.4 + s * 6;   // dissolve away on scroll
      this.cloud.visible = this.cloud.position.z < 7;
    }

    // Products: pure sinusoidal float + slow spin. NO mouse influence.
    for (const m of this.products) {
      const u = m.userData;
      m.rotation.y += u.spinSpeed * dt;
      m.rotation.x = Math.sin(this.time * u.floatSpeed * 0.7 + u.baseX) * 0.06; // POLISH — 0.10→0.06: less rock
      m.rotation.z = Math.cos(this.time * u.floatSpeed * 0.5 + u.baseZ) * 0.04; // POLISH — 0.06→0.04
      m.position.y = u.baseY + Math.sin(this.time * u.floatSpeed + u.baseX) * u.floatAmp;
      m.position.x = u.baseX + Math.cos(this.time * u.floatSpeed * 0.6) * 0.10;
      m.position.z = u.baseZ + s * 11;
      m.visible = m.position.z < 7;
      m.scale.setScalar(1 - s * 0.85);
    }

    if (this.particles) {
      this.particles.rotation.y = this.time * 0.014; // POLISH — 0.025→0.014: particle field barely rotates
      this.particles.material.opacity = lerp(0.28, 0.0, clamp(s * 1.2, 0, 1)); // CURATION — haze not confetti
    }

    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
  }
}

/* ============================================================
   BAKE SCENE — 5-stage cinematic sequence
   ----------------------------------------------------------------------
   Stage 1 (0.00–0.20): Products float in dark space (the 6 GLB models)
   Stage 2 (0.20–0.40): Walnuts fall + honey pours + flour cloud into bowl
   Stage 3 (0.40–0.60): Whisk spins in bowl, mixing
   Stage 4 (0.60–0.75): Tray zooms out into oven, door closes
   Stage 5 (0.75–1.00): Door opens, products fly out + steam
============================================================ */
export class BakeScene {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.progress = 0;
    this.time = 0;
    this.onProgress = opts.onProgress || (()=>{});
    this.ready = this.init();
  }

  async init() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: !IS_MOBILE, alpha: true,
    });
    // Guía 2 FASE 0B — capar pixel ratio (1.5 desktop, 1 mobile)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 2.2;
    // Sombras OFF en mobile (Guía 2 FASE 0B)
    this.renderer.shadowMap.enabled = !IS_MOBILE;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0d0f15, 10, 32); // CREATIVE DIR — matches sequence bg #0d0f15
    this.envMap = makeStudioEnvMap(this.renderer);
    this.scene.environment = this.envMap;

    this.camera = new THREE.PerspectiveCamera(38, w/h, 0.1, 100);
    this.camera.position.set(0, 1.4, 8);
    this.camera.lookAt(0, 0.3, 0);

    this.addLights();

    // Stage 1 models only — load immediately so hero is visible fast.
    // Stages 2-5 load lazily via loadLateModels() triggered on scroll.
    const stage1Urls = [
      { url: M.brownie,  options: { cropPlate: 0.34 } },
      { url: M.melokis,  options: { cropPlate: 0.18 } },
      { url: M.tejas,    options: { cropPlate: 0.20 } },
      { url: M.mille,    options: { cropPlate: 0.38 } },
      { url: M.petalos,  options: { cropPlate: 0.42 } },
    ];
    await modelManager.loadAll(stage1Urls, this.onProgress);

    this.buildStage1();
    // stage2-5 will be built after loadLateModels() resolves
    this.stage2 = null; this.stage3 = null; this.stage4 = null; this.stage5 = null;
    this.ovenGroup = null; this.mixer = null;
    this._lateLoaded = false;

    this.bind();
    this.tick();
  }

  /** Lazy-load models for stages 2-5. Called when .sequence enters the viewport. */
  async loadLateModels() {
    if (this._lateLoaded) return;
    this._lateLoaded = true;
    const lateUrls = [
      { url: M.nuez,    options: { cropPlate: 0.55 } },
      { url: M.batidora, options: { cropPlate: 0.05 } },
      { url: M.bandeja,  options: { cropPlate: 0.20 } },
    ];
    await modelManager.loadAll(lateUrls);
    this.buildStage2();
    this.buildStage3();
    this.buildStage4();
    this.buildStage5();
  }

  addLights() {
    this.ambient = new THREE.AmbientLight(0xffffff, 1.8);
    this.scene.add(this.ambient);
    this.keyLight = new THREE.DirectionalLight(0xfff0d8, 2.6);
    this.keyLight.position.set(4, 7, 5);
    // Rim cálido (antes era azul 0xb6c8ff — Guía 2 prohíbe azules)
    this.rimLight = new THREE.DirectionalLight(RIM_WARM, 1.1);
    this.rimLight.position.set(-5, 3, -3);
    this.fillLight = new THREE.PointLight(0xfff4dd, 25, 22);
    this.fillLight.position.set(2, 1, 4);
    // Nueva luz cálida frontal-superior — ilumina ingredientes y pasteles de frente
    const frontLight = new THREE.DirectionalLight(0xFFE8C0, 1.5);
    frontLight.position.set(0, 6, 8);
    this.scene.add(this.keyLight, this.rimLight, this.fillLight, frontLight);
  }

  /* ============ STAGE 1 — Floating products ============ */
  buildStage1() {
    const grp = new THREE.Group();
    this.stage1 = grp;

    // CURATION — Stage 1: 5 WHISK products, editorial orbit.
    // radius 2.7→3.4: breathing room. spinSpeed 0.15-0.30→0.05-0.09: luxury restraint.
    const productUrls = [M.brownie, M.melokis, M.tejas, M.mille, M.petalos];
    this.s1Products = [];
    productUrls.forEach((url, i) => {
      const m = modelManager.instance(url, 1.4);
      const angle = (i / productUrls.length) * Math.PI * 2;
      const r = 3.4;                          // wider orbit — less crowding
      m.position.set(
        Math.cos(angle) * r,
        Math.sin(i * 1.7) * 0.42,            // gentle vertical stagger
        Math.sin(angle) * r * 0.65 - 0.4    // compressed depth: all products readable
      );
      m.userData = {
        baseX: m.position.x, baseY: m.position.y, baseZ: m.position.z,
        floatPhase: Math.random() * Math.PI * 2,
        spinSpeed: rnd(0.05, 0.09) * (Math.random() < 0.5 ? -1 : 1), // very slow — meditative
      };
      grp.add(m);
      this.s1Products.push(m);
    });

    // CREATIVE DIR — stage 1 walnuts removed: random props cluttered the brand orbit.
    // Stage 1 is now the 5 WHISK products floating alone — clean, on-brand.
    this.s1Walnuts = [];

    // Flour-dust atmosphere — CURATION: 600→260, opacity 0.7→0.40
    // Sparse warm haze sits behind the products without competing with them.
    const count = 260;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i*3]   = rnd(-12, 12);
      positions[i*3+1] = rnd(-6, 6);
      positions[i*3+2] = rnd(-12, 2);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const sm = new THREE.PointsMaterial({
      size: 0.040, color: CREAM, transparent: true, opacity: 0.40,
      map: makeSoftSprite(), blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.s1Particles = new THREE.Points(sg, sm);
    grp.add(this.s1Particles);

    this.scene.add(grp);
  }

  /* ============ STAGE 2 — Ingredientes caen DENTRO del bowl ============
     Corrección 7/10 — orden EXACTO:
       1. Bowl grande aparece centrado (>40% pantalla)
       2. Huevo cae y se rompe (yema visible — se queda)
       3. Bolsa de harina se inclina y vierte (pila blanca crece y se queda)
       4. Cubo de mantequilla cae y se aplasta (se queda)
       5. Hilo de miel viscoso (charco crece y se queda)
       6. 3 nueces caen una por una (se quedan)
     Todo PERMANECE visible al terminar — no desaparece.
     Después → Stage 3: el batidor de varillas baja y mezcla. */
  buildStage2() {
    const grp = new THREE.Group();
    this.stage2 = grp;

    // ── BOWL 3D procedural GRANDE y centrado (>40% pantalla) ──
    this.bowl = buildBowl(2.0);
    this.bowl.position.set(0, -0.55, 0);
    grp.add(this.bowl);

    // CREATIVE DIR — KitchenAid removed from scene: competing with bowl narrative, not on-brand.
    // Instance kept (model already loaded) but NOT added to scene — no render cost.
    this.mixer = modelManager.instance(M.batidora, 2.6);
    this.mixer.visible = false;
    // this.scene.add(this.mixer); — deliberately excluded

    // Landing — DENTRO del bowl (rim en y=-0.55, fondo en y=-2.55)
    // -1.0 puts ingredients at mid-depth: clearly inside but visible from above camera
    const LAND_Y = -1.0;
    const LAND_X = 0.0;
    const LAND_Z = 0.0;

    // ─────────────── 1. HUEVO (cae y se rompe) ───────────────
    this.egg = buildProcEgg();
    this.egg.position.set(LAND_X - 0.35, 6.5, LAND_Z - 0.25);
    this.egg.userData.landX = LAND_X - 0.35;
    this.egg.userData.landZ = LAND_Z - 0.25;
    grp.add(this.egg);

    // ─────────────── 2. HARINA (bolsa + stream + nube + PILA permanente) ───────────────
    this.flourBag = buildFlourBag();
    // FIX — was x=-1.6 (outside bowl edge). Now x=-0.8: tipping from left into bowl center.
    this.flourBag.position.set(LAND_X - 0.8, 2.2, LAND_Z);
    grp.add(this.flourBag);
    this.flourStream = buildFlourStream();
    // FIX — was x=-0.6. Now nearly centered: stream falls straight into bowl cavity.
    this.flourStream.position.set(LAND_X - 0.05, 1.4, LAND_Z);
    this.flourStream.scale.set(1, 0, 1);
    grp.add(this.flourStream);
    // Nube de partículas de harina (efecto de polvo durante el vertido)
    const fCount = 220;
    const fPos = new Float32Array(fCount * 3);
    const fStart = [];
    for (let i = 0; i < fCount; i++) {
      // FIX — was centered at x=-0.6. Now centered at x=0: cloud billows directly over bowl.
      const x = LAND_X + (Math.random()-0.5)*0.5;
      const y = 1.4 + Math.random()*0.3;
      const z = LAND_Z + (Math.random()-0.5)*0.5;
      fPos[i*3] = x; fPos[i*3+1] = y; fPos[i*3+2] = z;
      fStart.push({ x0: x, z0: z, delay: Math.random() * 0.5 });
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    this.flourCloud = new THREE.Points(fg, new THREE.PointsMaterial({
      size: 0.06, color: 0xfaf3df, transparent: true, opacity: 0,
      map: makeSoftSprite(), blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.flourCloud.userData.start = fStart;
    grp.add(this.flourCloud);
    // PILA de harina permanente — disco cremoso que crece y se queda visible
    this.flourPile = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.6, 0.22, 40),
      new THREE.MeshPhysicalMaterial({
        color: 0xf5ecd4, roughness: 0.95, metalness: 0.0,
        clearcoat: 0.1, clearcoatRoughness: 0.7,
        transparent: true, opacity: 1.0,
      })
    );
    this.flourPile.position.set(LAND_X, LAND_Y + 0.05, LAND_Z);
    this.flourPile.scale.setScalar(0);   // crece durante la animación
    // PASS 4 — pre-computed colors for zero-GC lerp during Stage 3 batter evolution
    this.flourPile.userData.colorFrom = new THREE.Color(0xf5ecd4);  // cream flour
    this.flourPile.userData.colorTo   = new THREE.Color(0xb47228);  // brownie batter
    grp.add(this.flourPile);

    // ─────────────── 3. MANTEQUILLA (cae y se derrite al impactar) ───────────────
    this.butter = buildButter();
    this.butter.position.set(LAND_X + 0.25, 6.5, LAND_Z + 0.15);
    this.butter.userData = { landX: LAND_X + 0.25, landZ: LAND_Z + 0.15 };
    grp.add(this.butter);

    // ─────────────── 4. MIEL (hilo dorado + charco) ───────────────
    this.honeyStream = buildHoneyStream();
    // FIX — was (-0.15, 1.6, 0.25) off-center. Now centered: honey falls straight into bowl.
    this.honeyStream.position.set(LAND_X, 1.6, LAND_Z);
    this.honeyStream.scale.set(1, 0, 1);
    grp.add(this.honeyStream);
    this.honeyPool = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 32),
      new THREE.MeshPhysicalMaterial({
        color: 0xd99a2a, roughness: 0.1, metalness: 0.0,
        clearcoat: 1.0, clearcoatRoughness: 0.05,
        transparent: true, opacity: 0, side: THREE.DoubleSide,
      })
    );
    this.honeyPool.rotation.x = -Math.PI / 2;
    // FIX — was (-0.15, y, 0.25) off-center. Now aligned with honey stream at bowl center.
    this.honeyPool.position.set(LAND_X, LAND_Y + 0.01, LAND_Z);
    grp.add(this.honeyPool);

    // ─────────────── 5. NUECES (3 individuales en secuencia) ───────────────
    this.fallingNuts = [];
    const nutOffsets = [
      [-0.35, 0.20],
      [ 0.30, -0.10],
      [ 0.10,  0.30],
    ];
    nutOffsets.forEach((off, i) => {
      const n = modelManager.instance(M.nuez, 0.32);
      n.userData = {
        // 3 nueces, cada una con delay propio dentro del bloque 0.75-1.00
        delay: i * 0.08,
        landX: LAND_X + off[0],
        landZ: LAND_Z + off[1],
        rotX: rnd(2, 5),
        rotY: rnd(2, 5),
        rotZ: rnd(1, 3),
      };
      n.position.set(n.userData.landX, 6.5 + i*0.2, n.userData.landZ);
      n.visible = false;
      grp.add(n);
      this.fallingNuts.push(n);
    });

    // ─────────────── 6. ESPECIAS / cacao (canela en partículas — Guía 3 FASE 3) ───────────────
    // Caen suavemente al final, permanecen visibles dentro del bowl.
    const spCount = 140;
    const spPos = new Float32Array(spCount * 3);
    const spStart = [];
    for (let i = 0; i < spCount; i++) {
      const x = (Math.random()-0.5) * 1.4;       // dispersas pero dentro del bowl (radio 2.0)
      const z = (Math.random()-0.5) * 1.4;
      const y = 2.2 + Math.random() * 0.6;
      spPos[i*3] = x; spPos[i*3+1] = y; spPos[i*3+2] = z;
      spStart.push({ x0: x, z0: z, y0: y, delay: Math.random() * 0.5 });
    }
    const spg = new THREE.BufferGeometry();
    spg.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
    this.spices = new THREE.Points(spg, new THREE.PointsMaterial({
      size: 0.055, color: 0x8a5a2b, transparent: true, opacity: 0,   // canela cálida
      map: makeSoftSprite(), blending: THREE.NormalBlending, depthWrite: false,
    }));
    this.spices.userData.start = spStart;
    grp.add(this.spices);

    grp.visible = false;
    this.scene.add(grp);
  }

  /* ============ STAGE 3 — Batidor de varillas baja al bowl y mezcla ============
     Corrección 7/10:
       - El BOWL (de Stage 2) sigue visible con todos los ingredientes adentro
       - El batidor de varillas (procedural) baja desde arriba
       - Gira DENTRO del bowl mezclando
       - Es PROPORCIONAL al bowl (más pequeño que el bowl, no más grande)
       - La KitchenAid sigue de decoración en el fondo derecho */
  buildStage3() {
    const grp = new THREE.Group();
    this.stage3 = grp;

    // Batidor de varillas procedural — proporcional al bowl (radio 2.0).
    // Escala 1.3 → basket radio ~0.68 = ~34% del radio del bowl. Bien adentro.
    this.s3Whisk = buildWhiskMesh(1.3);
    this.s3Whisk.position.set(0, 5, 0);   // arranca arriba, fuera de escena
    this.s3Whisk.visible = false;
    grp.add(this.s3Whisk);

    // Salpicaduras sutiles de masa (pequeñas, alrededor del bowl)
    const splashMat = new THREE.MeshPhysicalMaterial({
      color: 0xf6e7bf, roughness: 0.3, metalness: 0.0, clearcoat: 0.5,
    });
    this.splashes = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), splashMat);
      s.userData = { angle: (i/8) * Math.PI*2, phase: Math.random() * Math.PI*2 };
      grp.add(s);
      this.splashes.push(s);
    }

    grp.visible = false;
    this.scene.add(grp);
  }

  /* ============ STAGE 4 — Tray + oven sequence ============ */
  buildStage4() {
    const grp = new THREE.Group();
    this.stage4 = grp;

    // FIX — tray 3.4→4.2: 24% larger, fills oven cavity as real baking tray should
    this.tray = modelManager.instance(M.bandeja, 4.2);
    grp.add(this.tray);

    grp.visible = false;
    this.scene.add(grp);

    // ============================================================
    // SHARED OVEN — HORNO REALISTA usando fotos como texturas (Corrección 10/10)
    // · horno afuera.jpg → backdrop principal (cabinet + control panel + cavidad)
    // · DENTRO HORNO.jpg → textura del vidrio de la puerta (interior caliente)
    // · Puerta procedural mínima → única pieza geométrica (necesaria para animar)
    // · Cámara estática (sin rotación) durante Stages 4 y 5
    // ============================================================
    this.ovenGroup = new THREE.Group();
    this.ovenGroup.position.set(0, 0.2, -3.2);
    // FIX — cinematic 3/4 angle: ~22.5° Y rotation shows oven depth, tray enters diagonally
    this.ovenGroup.rotation.y = -Math.PI / 8;
    this.ovenGroup.visible = false;

    // FIX — photo texture REMOVED entirely (contained incorrect food content visible through glass).
    // Full procedural oven: dark warm steel body + glowing cavity + emissive window.
    // No external asset dependency — pure cinematic brand-correct construction.

    // Dimensiones
    const PHOTO_SIZE = 5.6;
    const DOOR_W = 4.0;
    const DOOR_H = 3.0;
    const CAVITY_CENTER_Y = -0.4;
    const HINGE_Y = CAVITY_CENTER_Y - DOOR_H/2;

    // ── BODY: dark steel oven chassis (replaces photo backdrop) ──
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x1c1e22, roughness: 0.55, metalness: 0.75,
      clearcoat: 0.3, clearcoatRoughness: 0.4,
    });
    this.ovenBackdrop = new THREE.Mesh(
      new THREE.BoxGeometry(PHOTO_SIZE, PHOTO_SIZE, 0.18),
      bodyMat
    );
    this.ovenBackdrop.position.set(0, 0, -0.09);
    this.ovenGroup.add(this.ovenBackdrop);

    // ── CAVITY INTERIOR: warm dark recess behind the door ──
    // Covers the window opening area; occludes the body behind it.
    // Emissive orange glow simulates baking heat — pure procedural, no photo needed.
    const cavityMat = new THREE.MeshStandardMaterial({
      color: 0x100804,
      emissive: 0xe84e00,
      emissiveIntensity: 0.50,
      roughness: 0.95,
      metalness: 0.0,
    });
    const cavityPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(DOOR_W * 0.95, DOOR_H * 0.95),
      cavityMat
    );
    cavityPlane.position.set(0, CAVITY_CENTER_Y, 0.02);
    this.ovenGroup.add(cavityPlane);
    this._cavityMat = cavityMat;   // stored for pulsing in animateStage4/5

    // ── PUERTA procedural — bisagra en la base de la cavidad, abre hacia abajo ──
    const doorHinge = new THREE.Group();
    doorHinge.position.set(0, HINGE_Y, 0.15);     // ligeramente delante del backdrop
    // Cuerpo de la puerta — acero oscuro mate
    const doorMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1c20, roughness: 0.42, metalness: 0.82,
      clearcoat: 0.5, clearcoatRoughness: 0.18,
    });
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.12),
      doorMat
    );
    door.position.y = DOOR_H/2;
    doorHinge.add(door);
    // CREATIVE DIR — warm amber glow replaces interior photo (was incorrect content).
    // Looks like a glowing oven interior — pure color, no external asset needed.
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(DOOR_W * 0.82, DOOR_H * 0.7),
      new THREE.MeshStandardMaterial({
        color: 0x1a0c04,
        emissive: 0xff6520,
        emissiveIntensity: 0.62,  // MICRO-POLISH — 0.55→0.62: richer glow, heat feels real
        transparent: true,
        opacity: 0.88,
        roughness: 0.9,
        metalness: 0.0,
      })
    );
    win.position.set(0, DOOR_H/2, 0.07);          // sobre la cara frontal de la puerta
    doorHinge.add(win);
    // Marco metálico fino alrededor del vidrio (4 tiras delgadas)
    const frameMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2d33, roughness: 0.3, metalness: 0.9,
    });
    const fW = DOOR_W * 0.82, fH = DOOR_H * 0.7, fT = 0.06;
    const frTop = new THREE.Mesh(new THREE.BoxGeometry(fW + fT*2, fT, 0.03), frameMat);
    frTop.position.set(0, DOOR_H/2 + fH/2 + fT/2, 0.09);
    doorHinge.add(frTop);
    const frBot = frTop.clone();
    frBot.position.set(0, DOOR_H/2 - fH/2 - fT/2, 0.09);
    doorHinge.add(frBot);
    const frL = new THREE.Mesh(new THREE.BoxGeometry(fT, fH, 0.03), frameMat);
    frL.position.set(-fW/2 - fT/2, DOOR_H/2, 0.09);
    doorHinge.add(frL);
    const frR = frL.clone();
    frR.position.set(fW/2 + fT/2, DOOR_H/2, 0.09);
    doorHinge.add(frR);
    // Manija cromada arriba
    const handleBar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, DOOR_W * 0.8, 16),
      new THREE.MeshPhysicalMaterial({ color: 0xc8cbd0, roughness: 0.18, metalness: 1.0 })
    );
    handleBar.rotation.z = Math.PI/2;
    handleBar.position.set(0, DOOR_H * 0.95, 0.16);
    doorHinge.add(handleBar);
    this.ovenGroup.add(doorHinge);
    this.doorHinge = doorHinge;

    // Guardamos referencia al material del vidrio para pulsar su luminosidad
    this._ovenWindow = win;

    // ── Luz interior cálida (pulsa cuando la puerta está abierta) ──
    this.ovenLight = new THREE.PointLight(0xff8a3a, 0, 8, 2);
    this.ovenLight.position.set(0, CAVITY_CENTER_Y, 0.3);
    this.ovenGroup.add(this.ovenLight);

    // Constantes guardadas para animaciones de Stage 5 (productos saliendo de la cavidad)
    this._cavityCenterY = CAVITY_CENTER_Y;

    // PASS 4 — Warm bakery steam: rises above oven as door closes + heat builds
    // Triggered during closeT (0.65-0.85) and pulseT (0.85-1.00) in Stage 4
    const stCount = 160;
    const stPos = new Float32Array(stCount * 3);
    const stData = [];
    for (let i = 0; i < stCount; i++) {
      const x = (Math.random() - 0.5) * 2.8;
      const z = (Math.random() - 0.5) * 0.7 - 3.2;   // above ovenGroup z pos
      stPos[i*3] = x; stPos[i*3+1] = 1.2; stPos[i*3+2] = z;
      stData.push({ x0: x, z0: z, phase: Math.random(), speed: 0.25 + Math.random() * 0.28 });
    }
    const stg = new THREE.BufferGeometry();
    stg.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
    this.s4Steam = new THREE.Points(stg, new THREE.PointsMaterial({
      size: 0.30, color: 0xfff0d8, transparent: true, opacity: 0,
      map: makeSoftSprite(), blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.s4Steam.userData.start = stData;
    this.scene.add(this.s4Steam);

    this.scene.add(this.ovenGroup);
  }

  /* ============ STAGE 5 — Door opens, products emerge ============ */
  buildStage5() {
    const grp = new THREE.Group();
    this.stage5 = grp;

    // Use the SHARED oven (already built in stage 4) — no second instance.
    // Stage 5 only owns the emerging products + steam.

    // Guía 2 FASE 2 STAGE 5 — los 5 productos WHISK vuelan HACIA el usuario uno por uno
    // (sin barba, sin torta, sin elementos extra). Cámara estática.
    const productUrls = [M.brownie, M.melokis, M.tejas, M.mille, M.petalos];
    this.finalProducts = [];
    const FINAL_SIZE = 1.0;
    // 5 destinos en diagonal frontal (no en círculo) — los productos vuelan hacia adelante
    const destinations = [
      [-1.6,  0.6,  1.0],  // top-left front
      [ 1.6,  0.6,  1.0],  // top-right front
      [-1.0, -0.4,  1.6],  // closer mid-left
      [ 1.0, -0.4,  1.6],  // closer mid-right
      [ 0.0, -0.6,  2.2],  // closest center bottom
    ];
    // ORIGEN: cavidad del horno. World coords = ovenGroup pos + cavity center offset
    // ovenGroup at (0, 0.2, -3.2) + cavity center y=-0.4 → world (0, -0.2, -3.0)
    const ORIGIN_X = 0.0;
    const ORIGIN_Y = -0.2;     // centro vertical de la cavidad en world coords
    const ORIGIN_Z = -3.0;     // justo delante del backdrop (z=-3.2)
    productUrls.forEach((url, i) => {
      const m = modelManager.instance(url, FINAL_SIZE);
      const dest = destinations[i];
      m.userData = {
        destX: dest[0], destY: dest[1], destZ: dest[2],
        spin: rnd(0.20, 0.35) * (Math.random() < 0.5 ? -1 : 1),
        floatPhase: Math.random() * Math.PI * 2,
        delay: 0.10 + i * 0.07,
      };
      m.position.set(ORIGIN_X, ORIGIN_Y, ORIGIN_Z);
      m.visible = false;
      grp.add(m);
      this.finalProducts.push(m);
    });

    // Steam — partículas calientes saliendo de la cavidad del horno
    const sCount = 220;
    const sPos = new Float32Array(sCount * 3);
    const sStart = [];
    for (let i = 0; i < sCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.4;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      sPos[i*3] = x; sPos[i*3+1] = ORIGIN_Y; sPos[i*3+2] = ORIGIN_Z + z * 0.3;
      sStart.push({ x, z, ang, r, phase: Math.random(), speed: 0.4 + Math.random() * 0.5 });
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    const sm = new THREE.PointsMaterial({
      size: 0.22, color: 0xffe9c0, transparent: true, opacity: 0,
      map: makeSoftSprite(), blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.steam = new THREE.Points(sg, sm);
    this.steam.userData.start = sStart;
    grp.add(this.steam);

    grp.visible = false;
    this.scene.add(grp);
  }

  bind() {
    this._onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.camera.aspect = w/h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', this._onResize, { passive: true });
  }

  setProgress(p) { this.progress = clamp(p, 0, 1); }
  // Lazy: app.js llama a esto cuando .sequence entra/sale del viewport
  setSequenceVisible(v) { this._sequenceVisible = !!v; }

  /* ─────────────── MAIN LOOP — choreograph 5 stages ─────────────── */
  tick(now = 0) {
    this._raf = requestAnimationFrame(t => this.tick(t));
    // Guía 2 FASE 0B — suspender cuando la pestaña está oculta
    if (document.hidden) return;
    // Skip render si la sección sequence está fuera del viewport (lazy stages)
    if (this._sequenceVisible === false) return;
    // Throttle a 60fps
    if (this._lastFrame && (now - this._lastFrame) < FRAME_MIN_MS) return;
    this._lastFrame = now;
    const dt = 0.016;
    this.time += dt;
    const p = this.progress;

    // Per-stage local progress (0..1 each)
    const t1 = clamp(p / 0.20, 0, 1);
    const t2 = clamp((p - 0.20) / 0.20, 0, 1);
    const t3 = clamp((p - 0.40) / 0.20, 0, 1);
    const t4 = clamp((p - 0.60) / 0.15, 0, 1);
    const t5 = clamp((p - 0.75) / 0.25, 0, 1);

    // CREATIVE DIR — clean scene separation: bowl exits BEFORE oven enters.
    // p=0.60-0.62 is a brief dark cinematic cut between the two scenes.
    // Bowl and oven NEVER coexist (was overlapping for 7% of scroll).
    this.stage1.visible = p < 0.25;
    if (this.stage2) this.stage2.visible = p > 0.18 && p < 0.60;   // bowl/ingredients — exits at 0.60
    if (this.stage3) this.stage3.visible = p > 0.38 && p < 0.60;   // whisk exits with bowl
    if (this.stage4) this.stage4.visible = p > 0.60 && p < 0.80;   // tray scene
    if (this.stage5) this.stage5.visible = p > 0.73;               // products fly out
    // Mixer removed from scene — never visible
    if (this.mixer) this.mixer.visible = false;
    // Oven appears at 0.62 (after bowl gone at 0.60) — cinematic cut gap preserved
    if (this.ovenGroup) this.ovenGroup.visible = p > 0.62;

    // Cinematic camera arc — front-facing throughout for stages 4 + 5
    if (p < 0.20) {
      // Stage 1: gentle drift
      this.camera.position.set(Math.sin(this.time * 0.12) * 0.8, 1.2 - t1 * 0.3, 8.5 - t1 * 1.5);
      this.camera.lookAt(0, 0.1, -0.5);
    } else if (p < 0.40) {
      // Stage 2: descend over bowl — tilt down to see INSIDE the bowl cavity
      this.camera.position.set(0, lerp(0.9, 1.8, easeInOut(t2)), lerp(7.0, 5.5, easeInOut(t2)));
      this.camera.lookAt(0, lerp(-0.1, -0.45, easeInOut(t2)), 0);
    } else if (p < 0.60) {
      // Stage 3: inherits Stage 2 end position → eases into close mixing view.
      // y 1.8→1.3 + z 5.5→4.5: continuous push-in, no snap at p=0.40.
      this.camera.position.set(0, lerp(1.8, 1.3, easeInOut(t3)), lerp(5.5, 4.5, easeInOut(t3)));
      this.camera.lookAt(0, lerp(-0.2, -0.10, easeInOut(t3)), 0);
    } else if (p < 0.75) {
      // Stage 4: cinematic 3/4 angle — camera left of center to complement oven Y rotation
      this.camera.position.set(-0.5, 0.5, 4.2);
      this.camera.lookAt(0, 0.2, -3.2);
    } else {
      // Stage 5: same 3/4 angle — oven stays in position as products emerge
      this.camera.position.set(-0.5, 0.5, 4.2);
      this.camera.lookAt(0, 0.2, -3.2);
    }

    if (this.stage1.visible) this.animateStage1(t1, p);
    if (this.stage2?.visible) this.animateStage2(t2, p);
    if (this.stage3?.visible) this.animateStage3(t3, p);
    if (this.stage4?.visible) this.animateStage4(t4, p);
    if (this.stage5?.visible) this.animateStage5(t5, p);

    // FASE 10 — Descargar geometrías de stages que ya pasaron permanentemente.
    // Solo se ejecuta una vez por stage (flag _disposed). Libera memoria GPU.
    if (p > 0.30 && !this._s1Disposed) {
      this._s1Disposed = true;
      if (this.s1Particles) {
        this.s1Particles.geometry.dispose();
        this.s1Particles.material.dispose();
      }
    }
    if (p > 0.65 && !this._s2Disposed) {
      this._s2Disposed = true;
      // Dispose particle systems de Stage 2 (las meshes de ingredientes se reutilizan en Stage 3)
      if (this.flourCloud) {
        this.flourCloud.geometry.dispose();
        this.flourCloud.material.dispose();
      }
      if (this.spices) {
        this.spices.geometry.dispose();
        this.spices.material.dispose();
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  animateStage1(t, p) {
    // CURATION — match HeroScene restraint: gentle drift, slow meditation, no demo-spin.
    this.s1Products.forEach((m, i) => {
      const u = m.userData;
      m.rotation.y += u.spinSpeed * 0.016;
      m.rotation.x = Math.sin(this.time * 0.28 + u.floatPhase) * 0.06; // 0.18→0.06: no aggressive rock
      m.rotation.z = Math.cos(this.time * 0.22 + u.floatPhase) * 0.03;
      m.position.y = u.baseY + Math.sin(this.time * 0.32 + u.floatPhase) * 0.15; // 0.25→0.15: float not bounce
      m.position.x = u.baseX + Math.cos(this.time * 0.18 + u.floatPhase) * 0.07;
    });
    this.s1Walnuts.forEach(n => {
      const u = n.userData;
      n.rotation.x += u.spinX * 0.016;
      n.rotation.y += u.spinY * 0.016;
      n.rotation.z += u.spinZ * 0.016;
      n.position.y = u.baseY + Math.sin(this.time * 0.5 + u.floatPhase) * 0.18;
    });
    if (this.s1Particles) this.s1Particles.rotation.y = this.time * 0.03;
  }

  animateStage2(t, p) {
    // CREATIVE DIR — mixer removed from scene (see buildStage2); bowl is the sole centerpiece
    const GRAV = 9.0;
    const LAND_Y = -1.0;   // DENTRO del bowl grande (rim -0.55, fondo -2.55) — matches buildStage2

    // ── 1. HUEVO: cae (0.00-0.14) + se rompe (0.14-0.20). Después: queda visible ──
    {
      const eg = this.egg;
      const u = eg.userData;
      const local = clamp(t / 0.20, 0, 1);
      if (local < 0.65) {
        const fall = local / 0.65;
        const y = Math.max(6.5 - 0.5*GRAV*(fall*1.0)*(fall*1.0), LAND_Y);
        eg.position.set(u.landX, y, u.landZ);
        eg.rotation.x += 0.05;
        eg.rotation.z += 0.04;
        u.whole.visible = true;
        u.half1.visible = u.half2.visible = u.yolk.visible = u.white.visible = false;
      } else {
        const crack = (local - 0.65) / 0.35;
        eg.position.set(u.landX, LAND_Y + 0.05, u.landZ);
        u.whole.visible = false;
        u.half1.visible = u.half2.visible = u.yolk.visible = u.white.visible = true;
        u.half1.position.x = -crack * 0.35; u.half1.rotation.z =  crack * 0.7;
        u.half2.position.x =  crack * 0.35; u.half2.rotation.z = -crack * 0.7;
        u.yolk.position.y  = lerp(0, -0.25, crack);
        u.yolk.scale.set(1 + crack*0.2, lerp(1, 0.5, crack), 1 + crack*0.2);
        u.white.position.y = lerp(0, -0.22, crack);
        u.white.scale.set(1.4 + crack*1.0, lerp(0.3, 0.15, crack), 1.4 + crack*1.0);
        u.white.material.opacity = 0.6 - crack*0.4;
      }
    }

    // ── 2. HARINA: bolsa inclina + stream + nube + PILA crece (0.20-0.40) ──
    {
      const local = clamp((t - 0.20) / 0.20, 0, 1);
      this.flourBag.position.y = lerp(2.0, 1.6, easeOut(local));
      this.flourBag.rotation.z = Math.PI * 0.35 + easeOut(local) * 0.5;
      this.flourStream.scale.y = easeOut(Math.min(local * 2, 1)) *
                                 lerp(1, 0, clamp((local - 0.85) * 7, 0, 1));
      // Nube de polvo solo durante el vertido (luego desaparece)
      this.flourCloud.material.opacity = lerp(0, 0.6, local) * lerp(1, 0, clamp((local - 0.7) * 4, 0, 1));
      const fp = this.flourCloud.geometry.attributes.position;
      const arr = fp.array;
      const start = this.flourCloud.userData.start;
      for (let i = 0; i < start.length; i++) {
        const s = start[i];
        const lp = clamp(local - s.delay * 0.3, 0, 1);
        arr[i*3]   = s.x0 + Math.sin(this.time*2 + i) * 0.04;
        arr[i*3+1] = lerp(1.4, LAND_Y + 0.15, lp);
        arr[i*3+2] = s.z0 + Math.cos(this.time*2 + i) * 0.04;
      }
      fp.needsUpdate = true;
      // PILA permanente — crece hasta scale 1 y se queda
      this.flourPile.scale.setScalar(easeOut(local));
    }

    // ── 3. MANTEQUILLA: cae + se aplasta/derrite al impactar (0.40-0.55) ──
    {
      const u = this.butter.userData;
      const local = clamp((t - 0.40) / 0.15, 0, 1);
      if (local <= 0) { this.butter.visible = false; }
      else {
        this.butter.visible = true;
        const fall = local * 1.4;
        const y = Math.max(6.5 - 0.5*GRAV*fall*fall, LAND_Y);
        this.butter.position.set(u.landX, y, u.landZ);
        const landed = y === LAND_Y;
        if (!landed) {
          this.butter.rotation.x += 0.04;
          this.butter.rotation.z += 0.03;
          this.butter.scale.set(1, 1, 1);
        } else {
          // En el suelo: se aplasta/derrite (suave) — se QUEDA visible
          const meltPct = clamp((local - 0.50) / 0.50, 0, 1);
          this.butter.rotation.set(0, this.butter.rotation.y, 0);
          this.butter.scale.set(
            1 + meltPct * 0.7,
            lerp(1, 0.30, meltPct),
            1 + meltPct * 0.7
          );
          if (this.butter.material) {
            this.butter.material.clearcoat = lerp(0.45, 0.15, meltPct);
            this.butter.material.transmission = lerp(0.08, 0.25, meltPct);
          }
        }
      }
    }

    // ── 4. MIEL: hilo dorado viscoso + charco crece (0.55-0.75) ──
    {
      const local = clamp((t - 0.55) / 0.20, 0, 1);
      // Hilo: aparece, cae viscoso, luego se corta suavemente
      this.honeyStream.scale.y = easeOut(Math.min(local * 1.6, 1)) *
                                  lerp(1, 0, clamp((local - 0.8) * 5, 0, 1));
      // Ligero balanceo viscoso del hilo
      this.honeyStream.rotation.z = Math.sin(this.time * 1.8) * 0.06 * (1 - clamp((local-0.7)*3, 0, 1));
      // Charco: crece hasta scale 1 y se QUEDA visible
      this.honeyPool.material.opacity = lerp(0, 0.92, easeOut(local));
      this.honeyPool.scale.setScalar(lerp(0.3, 1.1, easeOut(local)));
    }

    // ── 5. NUECES: 3 caen una por una (0.75-1.00). Quedan visibles ──
    this.fallingNuts.forEach(n => {
      const u = n.userData;
      const baseT = 0.75;
      const local = clamp((t - baseT - u.delay) / 0.18, 0, 1);
      if (local <= 0) { n.visible = false; return; }
      n.visible = true;
      const fall = local * 1.3;
      const y = Math.max(6.5 - 0.5*GRAV*fall*fall, LAND_Y);
      n.position.set(u.landX, y, u.landZ);
      n.rotation.x += u.rotX * 0.016;
      n.rotation.y += u.rotY * 0.016;
      n.rotation.z += u.rotZ * 0.016;
    });

    // ── 6. ESPECIAS / cacao: partículas caen suaves y REPOSAN dentro del bowl
    //       (0.85-1.00 — Guía 3 FASE 3). Permanecen visibles, no desaparecen. ──
    {
      const local = clamp((t - 0.85) / 0.15, 0, 1);
      this.spices.material.opacity = lerp(0, 0.9, easeOut(local));
      const sp = this.spices.geometry.attributes.position;
      const arr = sp.array;
      const start = this.spices.userData.start;
      for (let i = 0; i < start.length; i++) {
        const s = start[i];
        const lp = clamp(local - s.delay * 0.3, 0, 1);
        // Movimiento ligero horizontal mientras cae (deriva natural)
        arr[i*3]   = s.x0 + Math.sin(this.time*1.5 + i) * 0.025;
        // Caída desde la altura inicial hasta LAND_Y dentro del bowl
        arr[i*3+1] = lerp(s.y0, LAND_Y + 0.05, easeIn(lp));
        arr[i*3+2] = s.z0 + Math.cos(this.time*1.5 + i) * 0.025;
      }
      sp.needsUpdate = true;
    }
  }

  animateStage3(t, p) {
    // CREATIVE DIR — bowl (stage2 still visible) + descending whisk only; mixer not in scene

    // ── BATIDOR DE VARILLAS ──
    // Fase 1 (t = 0 → 0.30): desciende desde y=5 hasta y=0 (basket dentro del bowl)
    // Fase 2 (t = 0.30 → 1.00): gira rápido dentro del bowl
    const descendT = clamp(t / 0.30, 0, 1);
    const mixT     = clamp((t - 0.30) / 0.70, 0, 1);
    if (this.s3Whisk) {
      this.s3Whisk.visible = true;
      // Descenso suave (cubic ease) — basket entra al bowl
      this.s3Whisk.position.y = lerp(5.0, 0.0, easeOut(descendT));
      // Rotación: lenta durante descenso, rápida durante mezcla
      const spinSpeed = lerp(0.5, 8.0, mixT);
      this.s3Whisk.rotation.y += spinSpeed * 0.016;
      // Pequeño tambaleo (mezclando)
      this.s3Whisk.rotation.x = Math.sin(this.time * 4) * 0.05 * mixT;
      this.s3Whisk.rotation.z = Math.cos(this.time * 3.5) * 0.05 * mixT;
      // Pequeña traslación lateral simulando movimiento de mezclado
      this.s3Whisk.position.x = Math.sin(this.time * 2.2) * 0.25 * mixT;
      this.s3Whisk.position.z = Math.cos(this.time * 2.5) * 0.25 * mixT;
    }

    // ── BATTER EVOLUTION — ingredientes se integran en masa unificada ──
    // La pila de harina (centerpiece del bowl) evoluciona: cream → brownie batter
    // Los ingredientes individuales se funden conforme la mezcla avanza.
    {
      const evolveT = clamp((mixT - 0.15) / 0.65, 0, 1);
      const eEvol   = easeInOut(evolveT);

      // Flour pile → brownie batter: cambia color + se expande para llenar el bowl
      if (this.flourPile) {
        const cf = this.flourPile.userData.colorFrom;
        const ct = this.flourPile.userData.colorTo;
        if (cf && ct) this.flourPile.material.color.lerpColors(cf, ct, eEvol);
        // Spreads wider as batter forms (1.0 at start of mixing → 1.65 fully mixed)
        const baseScale = this.flourPile.scale.x || 1;
        if (baseScale > 0.05) {  // only after flourPile is already grown in (Stage 2)
          this.flourPile.scale.setScalar(lerp(1.0, 1.65, eEvol));
        }
        this.flourPile.material.roughness = lerp(0.95, 0.62, eEvol);
      }

      // Honey pool sinks into the forming batter
      if (this.honeyPool) {
        this.honeyPool.material.opacity = lerp(0.92, 0.0, eEvol);
      }

      // Butter melts/fades into batter
      if (this.butter) {
        this.butter.material.transparent = true;
        this.butter.material.opacity = 1.0 - clamp(evolveT * 1.8, 0, 1);
      }

      // Spices: stay faintly visible — they leave a cacao dusting on the batter surface
      if (this.spices) {
        this.spices.material.opacity = lerp(0.9, 0.25, eEvol);
      }
    }

    // Salpicaduras sutiles — solo durante la mezcla activa
    this.splashes.forEach(s => {
      const lt = (this.time * 2.4 + s.userData.phase) % 1.4;
      const r = 0.55 + lt * 0.6;
      s.position.set(
        Math.cos(s.userData.angle + this.time * 3.2) * r,
        -1.0 + Math.sin(lt * Math.PI) * 0.7,    // alrededor del rim del bowl
        Math.sin(s.userData.angle + this.time * 3.2) * r * 0.6
      );
      const sc = Math.max(0, 1 - lt / 1.4) * mixT * 0.7;
      s.scale.setScalar(sc);
      s.visible = sc > 0.02;
    });
  }

  animateStage4(t, p) {
    // Corrección 10/10 — secuencia EXACTA del horno:
    //   0.00-0.10  Horno aparece de frente (settle in, puerta CERRADA)
    //   0.10-0.30  Puerta se ABRE hacia abajo
    //   0.30-0.65  Bandeja con brownies ENTRA al horno
    //   0.65-0.85  Puerta se CIERRA
    //   0.85-1.00  Luz cálida naranja PULSA adentro (visible por la ventana)
    const settleT = clamp(t / 0.18, 0, 1); // MICRO-POLISH — 0.10→0.18: oven eases in, not snaps in
    const openT   = clamp((t - 0.10) / 0.20, 0, 1);
    const enterT  = clamp((t - 0.30) / 0.35, 0, 1);
    const closeT  = clamp((t - 0.65) / 0.20, 0, 1);
    const pulseT  = clamp((t - 0.85) / 0.15, 0, 1);

    // Horno aparece con leve grow-in (NO la cámara — el horno mismo)
    this.ovenGroup.scale.setScalar(lerp(0.94, 1.0, easeOut(settleT)));

    // ── Estado de la puerta ──
    //   t<0.10: cerrada (rot 0)
    //   0.10-0.30: abre (0 → -PI/2)
    //   0.30-0.65: completamente abierta (-PI/2)
    //   0.65-0.85: cierra (-PI/2 → 0)
    //   t>0.85: cerrada (0)
    let doorRot;
    if      (t < 0.10) doorRot = 0;
    else if (t < 0.30) doorRot = lerp(0, -Math.PI/2, easeInOut(openT));
    else if (t < 0.65) doorRot = -Math.PI/2;
    else if (t < 0.85) doorRot = lerp(-Math.PI/2, 0, easeInOut(closeT));
    else               doorRot = 0;
    this.doorHinge.rotation.x = doorRot;
    const doorIsOpen = (t >= 0.10 && t < 0.85);

    // ── Bandeja con brownies — entra desde el frente hacia la cavidad ──
    if (enterT <= 0) {
      this.tray.visible = false;
    } else {
      this.tray.visible = true;
      const eEnter = easeInOut(enterT);
      // CREATIVE DIR — tray slides from close to camera diagonally into oven cavity.
      // Starts nearer (z=3.2) for more dramatic presence; scale range tightened (base size 2.6).
      this.tray.position.x = 0;
      this.tray.position.y = lerp( 0.6, -0.42, eEnter);
      this.tray.position.z = lerp( 3.2, -3.05, eEnter);  // FIX: slides deeper into cavity
      this.tray.scale.setScalar(lerp(1.06, 1.0, eEnter)); // tray is large (4.2) — minimal entry scale pop
      this.tray.rotation.x = lerp(0, -0.10, enterT);
    }

    // ── Luz interior cálida ──
    // Brillante mientras la puerta está abierta + bandeja entrando
    // Luego pulsa visiblemente a través del vidrio cuando la puerta se cierra
    const basePulse = 1 + Math.sin(this.time * 3.5) * 0.18;
    const lightBase = doorIsOpen ? 6.0 : 4.5;
    this.ovenLight.intensity = lightBase * basePulse * Math.max(settleT, 0.1);

    // Vidrio de la puerta: más transparente cuando puerta abierta (se ve atrás),
    // menos transparente cuando cerrada pero deja ver la luz pulsante del interior
    if (this._ovenWindow) {
      this._ovenWindow.material.opacity = doorIsOpen ? 0.4 : (0.78 + Math.sin(this.time * 3.5) * 0.08);
    }
    // Cavity interior glow: pulses with heat during close + baking phase
    if (this._cavityMat) {
      const heatPulse = 0.50 + Math.sin(this.time * 2.8) * 0.12 * clamp(closeT + pulseT, 0, 1);
      this._cavityMat.emissiveIntensity = doorIsOpen ? 0.50 : heatPulse;
    }

    // Fill light cálido — MICRO-POLISH: 55→42 open (less raw), 30→26 closed (more intimate)
    this.fillLight.intensity = doorIsOpen ? 42 : 26;
    this.fillLight.color.setRGB(1, 0.78, 0.5);

    // PASS 4 — Warm bakery steam rises as door closes and heat pulses through the glass
    if (this.s4Steam) {
      // Steam only visible during closeT + pulseT (door is shutting → oven is alive)
      const steamOpacity = clamp(closeT * 0.7 + pulseT * 0.35, 0, 0.42);
      this.s4Steam.material.opacity = steamOpacity;
      if (steamOpacity > 0.005) {
        const sPos = this.s4Steam.geometry.attributes.position;
        const arr  = sPos.array;
        const data = this.s4Steam.userData.start;
        for (let i = 0; i < data.length; i++) {
          const s = data[i];
          const phase = (this.time * s.speed + s.phase) % 1.0;
          arr[i*3]   = s.x0 + Math.sin(this.time * 0.6 + i) * 0.14 * phase;
          arr[i*3+1] = 1.2 + phase * 2.2;   // rises 2.2 units above oven top
          arr[i*3+2] = s.z0 + Math.cos(this.time * 0.5 + i) * 0.10 * phase;
        }
        sPos.needsUpdate = true;
      }
    }
  }

  animateStage5(t, p) {
    // Mismo horno, misma puerta. Vuelve a abrir de cerrada → horizontal.
    const openT = clamp(t / 0.25, 0, 1);
    this.doorHinge.rotation.x = lerp(0, -Math.PI/2, easeInOut(openT));
    this.ovenLight.intensity = 6 * openT;
    // El vidrio de la puerta (con foto del interior) brilla más cuando empieza a abrir
    if (this._ovenWindow) {
      this._ovenWindow.material.opacity = lerp(0.92, 0.6, openT);
    }

    // Origen de los productos = centro de la cavidad del horno (world coords)
    const ORIGIN_X = 0.0, ORIGIN_Y = -0.2, ORIGIN_Z = -3.0;

    // Productos vuelan HACIA EL USUARIO desde la cavidad del horno
    this.finalProducts.forEach((m, i) => {
      const u = m.userData;
      const local = clamp((t - u.delay) / 0.55, 0, 1);
      if (local <= 0) { m.visible = false; return; }
      m.visible = true;
      const e = easeOut(local);
      m.position.x = lerp(ORIGIN_X, u.destX, e);
      m.position.y = lerp(ORIGIN_Y, u.destY, e) + Math.sin(this.time * 0.8 + u.floatPhase) * 0.10 * e;
      m.position.z = lerp(ORIGIN_Z, u.destZ, e);
      // Spin suave (sin revoluciones completas)
      m.rotation.y = this.time * u.spin * 0.4;
      m.rotation.x = Math.sin(this.time * 0.3 + u.floatPhase) * 0.08;
    });

    // CÁMARA ESTÁTICA — el horno NO rota, NO se mueve (Corrección 10/10)

    // Vapor saliendo de la cavidad del horno
    const sPos = this.steam.geometry.attributes.position;
    const arr = sPos.array;
    const start = this.steam.userData.start;
    for (let i = 0; i < start.length; i++) {
      const s = start[i];
      const phase = (this.time * s.speed + s.phase) % 1.0;
      arr[i*3]   = s.x + Math.sin(this.time + i) * 0.15 * phase;
      arr[i*3+1] = ORIGIN_Y + phase * 2.8;
      arr[i*3+2] = ORIGIN_Z + s.z * 0.3 + Math.cos(this.time + i) * 0.15 * phase + phase * 0.5;
    }
    sPos.needsUpdate = true;
    this.steam.material.opacity = 0.5 * openT;
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
  }
}

/* ============================================================
   ABOUT SCENE — slowly rotating polished whisk (procedural)
============================================================ */
export class AboutScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = 0;
    this.init();
  }
  init() {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || 400, h = rect.height || 500;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !IS_MOBILE, alpha: true });
    // Guía 2 FASE 0B — capar pixel ratio
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP));
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = false;
    this.scene = new THREE.Scene();
    this.scene.environment = makeStudioEnvMap(this.renderer);
    this.camera = new THREE.PerspectiveCamera(38, w/h, 0.1, 100);
    this.camera.position.set(0.4, 0.6, 5);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff5e0, 2.4);
    key.position.set(3, 5, 4);
    // Rim cálido (antes era azul 0xc4d3ff — Guía 2 prohíbe azules)
    const rim = new THREE.DirectionalLight(RIM_WARM, 1.0);
    rim.position.set(-4, 0, -3);
    this.scene.add(key, rim);
    this.whisk = buildWhiskMesh(1.15);
    this.whisk.position.y = 0.4;
    this.scene.add(this.whisk);
    // Floating cream particles
    const count = 120;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i*3] = rnd(-3, 3); positions[i*3+1] = rnd(-2, 2); positions[i*3+2] = rnd(-2, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ size: 0.04, color: CREAM, transparent: true, opacity: 0.45 });
    this.points = new THREE.Points(geo, mat);
    this.scene.add(this.points);
    this._onResize = () => {
      const r = this.canvas.getBoundingClientRect();
      this.camera.aspect = r.width / r.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(r.width, r.height, false);
    };
    window.addEventListener('resize', this._onResize, { passive: true });
    this.tick();
  }
  tick(now = 0) {
    this._raf = requestAnimationFrame(t => this.tick(t));
    // Guía 2 FASE 0B — pausa al ocultar pestaña + throttle 60fps
    if (document.hidden) return;
    if (this._lastFrame && (now - this._lastFrame) < FRAME_MIN_MS) return;
    this._lastFrame = now;
    this.time += 0.016;
    this.whisk.rotation.y = this.time * 0.55;
    this.whisk.rotation.x = Math.sin(this.time * 0.4) * 0.18;
    this.whisk.position.y = 0.4 + Math.sin(this.time) * 0.08;
    this.points.rotation.y = this.time * 0.08;
    this.renderer.render(this.scene, this.camera);
  }
}

// Backwards-compat: also expose on window so app.js (module or UMD) can find it
window.WHISK_SCENES = { HeroScene, BakeScene, AboutScene };
