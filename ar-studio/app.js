/* ============================================================
   KITE — WebAR studio
   Three.js stage, procedural asset lab, QR publishing.
   ============================================================ */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const FONT_URL =
    "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json";

  /* ============================================================
     Small utilities
     ============================================================ */

  function disposeObject(object) {
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material) return;
        Object.values(material).forEach((value) => {
          if (value && value.isTexture) value.dispose();
        });
        material.dispose?.();
      });
    });
  }

  function cloneWithMaterials(object) {
    const copy = object.clone(true);
    copy.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry = child.geometry.clone();
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => material.clone())
        : child.material.clone();
    });
    return copy;
  }

  function markShadows(object) {
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material?.map) material.map.colorSpace = THREE.SRGBColorSpace;
      });
    });
  }

  function countTriangles(object) {
    let triangles = 0;
    object.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      const geometry = child.geometry;
      triangles += geometry.index
        ? geometry.index.count / 3
        : (geometry.attributes.position?.count || 0) / 3;
    });
    return Math.round(triangles);
  }

  function fitObject(object, { size = 2.4, ground = true, lift = 0, center = true } = {}) {
    object.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(object);
    const dimensions = box.getSize(new THREE.Vector3());
    const maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z) || 1;
    object.scale.multiplyScalar(size / maxDimension);
    object.updateMatrixWorld(true);

    box = new THREE.Box3().setFromObject(object);
    const centerPoint = box.getCenter(new THREE.Vector3());
    if (center) {
      object.position.x -= centerPoint.x;
      object.position.z -= centerPoint.z;
    }
    object.position.y -= ground ? box.min.y : centerPoint.y;
    object.position.y += lift;
    return { box, dimensions: box.getSize(new THREE.Vector3()) };
  }

  function slugify(value) {
    return String(value || "kite-model")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "kite-model";
  }

  /* ============================================================
     Global render loop
     ============================================================ */

  const viewers = [];

  const viewObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const viewer = entry.target.__kiteViewer;
        if (viewer) viewer.visible = entry.isIntersecting;
      });
    },
    { rootMargin: "240px 0px" }
  );

  let lastFrame = performance.now();

  function tick(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    if (!document.hidden) {
      for (const viewer of viewers) {
        if (!viewer.visible) continue;
        viewer.controls?.update();
        viewer.mixers.forEach((mixer) => mixer.update(dt));
        viewer.updates.forEach((update) => update(dt, now / 1000));
        viewer.renderer.render(viewer.scene, viewer.camera);
      }
    }

    requestAnimationFrame(tick);
  }

  /* ============================================================
     Three.js viewer factory
     ============================================================ */

  function createViewer(canvas, options = {}) {
    const {
      alpha = false,
      background = null,
      fov = 35,
      cameraPosition = [0, 1.8, 4.6],
      target = [0, 1, 0],
      interactive = true,
      shadows = true,
      environment = true,
      minDistance = 1.4,
      maxDistance = 9,
    } = options;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    if (background) scene.background = new THREE.Color(background);

    const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 120);
    camera.position.set(...cameraPosition);

    let controls = null;
    if (interactive) {
      controls = new OrbitControls(camera, canvas);
      controls.target.set(...target);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;
      controls.minDistance = minDistance;
      controls.maxDistance = maxDistance;
      controls.maxPolarAngle = Math.PI / 2 - 0.035;
      controls.minPolarAngle = 0.16;
      controls.autoRotateSpeed = 1.25;
      controls.update();
    } else {
      camera.lookAt(new THREE.Vector3(...target));
    }

    if (environment) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }

    scene.add(new THREE.HemisphereLight(0xffffff, 0x454555, 1.45));

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.35);
    keyLight.position.set(4.5, 7, 5);
    keyLight.castShadow = shadows;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -5;
    keyLight.shadow.camera.right = 5;
    keyLight.shadow.camera.top = 6;
    keyLight.shadow.camera.bottom = -2;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 22;
    keyLight.shadow.bias = -0.0004;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xcfe1ff, 1.25);
    fillLight.position.set(-5, 3, 2.5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xd8ff3e, 1.3);
    rimLight.position.set(0, 4.5, -5);
    scene.add(rimLight);

    if (shadows) {
      const shadowPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 24),
        new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.16 })
      );
      shadowPlane.rotation.x = -Math.PI / 2;
      shadowPlane.receiveShadow = true;
      scene.add(shadowPlane);
    }

    const homePosition = camera.position.clone();
    const homeTarget = controls ? controls.target.clone() : new THREE.Vector3(...target);

    const viewer = {
      renderer,
      scene,
      camera,
      controls,
      mixers: [],
      updates: [],
      visible: true,
      canvas,
      homePosition,
      homeTarget,
      resize() {
        const host = canvas.parentElement;
        const width = host?.clientWidth || canvas.clientWidth;
        const height = host?.clientHeight || canvas.clientHeight;
        if (!width || !height) return;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      },
      resetCamera() {
        camera.position.copy(homePosition);
        if (controls) {
          controls.target.copy(homeTarget);
          controls.update();
        } else {
          camera.lookAt(homeTarget);
        }
      },
    };

    const resizeObserver = new ResizeObserver(() => viewer.resize());
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
      canvas.parentElement.__kiteViewer = viewer;
      viewObserver.observe(canvas.parentElement);
    }
    viewer.resize();
    viewers.push(viewer);
    return viewer;
  }

  const gltfLoader = new GLTFLoader();
  function loadGLB(url) {
    return new Promise((resolve, reject) => gltfLoader.load(url, resolve, undefined, reject));
  }

  function playAnimations(gltf, viewer, root) {
    if (!gltf.animations?.length) return null;
    let clips = gltf.animations;
    if (clips.length > 6) {
      const idle = clips.find((clip) => /idle|stand/i.test(clip.name));
      clips = [idle || clips[0]];
    }
    const mixer = new THREE.AnimationMixer(root);
    clips.forEach((clip) => mixer.clipAction(clip).play());
    viewer.mixers.push(mixer);
    return mixer;
  }

  /* ============================================================
     Preset data
     ============================================================ */

  const PRESETS = {
    model: [
      { id: "chair", name: "Sheen chair", tag: "GLB · furniture", url: "models/chair.glb", meta: "GLB · furniture · PBR", glyph: "▣", c1: "#cfe1ff", c2: "#2447ff" },
      { id: "robot", name: "Expressive robot", tag: "GLB · character", url: "models/robot.glb", meta: "GLB · character · PBR", glyph: "☻", c1: "#d8ff3e", c2: "#0b0b0c" },
      { id: "parrot", name: "Parrot", tag: "GLB · animated", url: "models/parrot.glb", meta: "GLB · animated · wingbeat", glyph: "◉", c1: "#ff5a36", c2: "#2447ff" },
      { id: "horse", name: "Horse", tag: "GLB · animated", url: "models/horse.glb", meta: "GLB · animated · gallop", glyph: "♞", c1: "#cfe1ff", c2: "#1227b8" },
      { id: "flamingo", name: "Flamingo", tag: "GLB · animated", url: "models/flamingo.glb", meta: "GLB · animated · flight", glyph: "✦", c1: "#ffb3a3", c2: "#ff5a36" },
      { id: "helmet", name: "Damaged helmet", tag: "GLB · headwear", url: "models/helmet.glb", meta: "GLB · headwear · PBR", glyph: "◠", c1: "#d8ff3e", c2: "#2447ff" },
    ],
    face: [
      { id: "helmet", name: "Damaged helmet", tag: "TRY-ON · headwear", url: "models/helmet.glb", meta: "GLB · headwear · PBR", glyph: "◠", c1: "#d8ff3e", c2: "#2447ff" },
      { id: "face", name: "Face capture", tag: "TRY-ON · blendshapes", url: "models/face.glb", meta: "GLB · face · blendshapes", glyph: "☺", c1: "#cfe1ff", c2: "#2447ff" },
      { id: "robot", name: "Robot head", tag: "TRY-ON · character", url: "models/robot.glb", meta: "GLB · character · PBR", glyph: "◉", c1: "#ff5a36", c2: "#0b0b0c" },
    ],
    image: [
      { id: "poster-kite", art: "kite", name: "Kite poster", tag: "IMAGE · flat art", meta: "Image AR · poster · flat art", glyph: "◆", c1: "#2447ff", c2: "#d8ff3e" },
      { id: "poster-grid", art: "grid", name: "Grid study", tag: "IMAGE · flat art", meta: "Image AR · poster · graphic", glyph: "▦", c1: "#d8ff3e", c2: "#0b0b0c" },
      { id: "poster-sun", art: "sun", name: "Sun print", tag: "IMAGE · flat art", meta: "Image AR · poster · print", glyph: "☀", c1: "#ff5a36", c2: "#d8ff3e" },
    ],
    picture: [
      { id: "frame-form", art: "gallery", name: "Form / 01", tag: "FRAME · wall art", meta: "Picture frame · wall art", glyph: "▤", c1: "#cfe1ff", c2: "#2447ff" },
      { id: "frame-type", art: "type", name: "Type / 02", tag: "FRAME · wall art", meta: "Picture frame · typography", glyph: "A", c1: "#d8ff3e", c2: "#0b0b0c" },
      { id: "frame-orbit", art: "orbit", name: "Orbit / 03", tag: "FRAME · wall art", meta: "Picture frame · graphic", glyph: "◎", c1: "#2447ff", c2: "#cfe1ff" },
    ],
    text: [
      { id: "word-kite", word: "KITE", name: "KITE", tag: "WORD · cobalt", color: "#2447ff", glyph: "K", c1: "#cfe1ff", c2: "#2447ff" },
      { id: "word-hello", word: "HELLO", name: "HELLO", tag: "WORD · acid", color: "#a8c900", glyph: "H", c1: "#d8ff3e", c2: "#0b0b0c" },
      { id: "word-wow", word: "WOW", name: "WOW", tag: "WORD · coral", color: "#ff5a36", glyph: "W", c1: "#ffb3a3", c2: "#ff5a36" },
      { id: "word-2026", word: "2026", name: "2026", tag: "WORD · chrome", color: "#d8dde6", glyph: "2", c1: "#e8ebf0", c2: "#5d5a52" },
    ],
    svg: [
      { id: "svg-star", shape: "star", name: "Star", tag: "SVG · extruded", meta: "SVG to 3D · extruded · acid", glyph: "★", c1: "#d8ff3e", c2: "#0b0b0c" },
      { id: "svg-bolt", shape: "bolt", name: "Bolt", tag: "SVG · extruded", meta: "SVG to 3D · extruded · coral", glyph: "ϟ", c1: "#ff5a36", c2: "#2447ff" },
      { id: "svg-kite", shape: "kite", name: "Kite", tag: "SVG · extruded", meta: "SVG to 3D · extruded · cobalt", glyph: "◇", c1: "#2447ff", c2: "#cfe1ff" },
      { id: "svg-ring", shape: "ring", name: "Ring", tag: "SVG · extruded", meta: "SVG to 3D · extruded · gold", glyph: "○", c1: "#ffc94a", c2: "#0b0b0c" },
    ],
  };

  const MODES = {
    model: {
      type: "MODEL AR",
      title: "Pick a model",
      uploadTitle: "Drop a GLB model",
      uploadSub: "or click to browse · GLB recommended",
      accept: ".glb,.gltf,model/gltf-binary,model/gltf+json",
      upload: true,
    },
    face: {
      type: "FACE AR",
      title: "Pick a try-on",
      uploadTitle: "Drop a GLB headpiece",
      uploadSub: "or click to browse · helmet, mask, glasses",
      accept: ".glb,.gltf,model/gltf-binary,model/gltf+json",
      upload: true,
    },
    image: {
      type: "IMAGE AR",
      title: "Pick artwork",
      uploadTitle: "Drop a JPG or PNG",
      uploadSub: "or click to browse · used as a poster",
      accept: "image/*",
      upload: true,
    },
    picture: {
      type: "PICTURE FRAME",
      title: "Pick a print",
      uploadTitle: "Drop a photo to frame",
      uploadSub: "or click to browse · JPG, PNG",
      accept: "image/*",
      upload: true,
    },
    text: {
      type: "3D TEXT",
      title: "Type something",
      uploadTitle: "",
      uploadSub: "",
      accept: "",
      upload: false,
    },
    svg: {
      type: "SVG TO 3D",
      title: "Pick a shape",
      uploadTitle: "Drop an SVG",
      uploadSub: "or click to browse · logo, icon, mark",
      accept: ".svg,image/svg+xml",
      upload: true,
    },
  };

  /* ============================================================
     HERO
     ============================================================ */

  const heroViewer = createViewer($("hero-canvas"), {
    alpha: true,
    fov: 38,
    cameraPosition: [0, 1.05, 4.4],
    target: [0, 0.95, 0],
    interactive: false,
    shadows: false,
  });
  heroViewer.scene.background = null;

  const heroRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.28, 0.008, 8, 140),
    new THREE.MeshBasicMaterial({ color: 0xd8ff3e, transparent: true, opacity: 0.9 })
  );
  heroRing.rotation.set(Math.PI / 2.5, 0.35, 0.2);
  heroViewer.scene.add(heroRing);

  const heroRingTwo = new THREE.Mesh(
    new THREE.TorusGeometry(1.55, 0.006, 8, 140),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32 })
  );
  heroRingTwo.rotation.set(Math.PI / 2.1, -0.4, 0.7);
  heroViewer.scene.add(heroRingTwo);

  const heroDots = new THREE.Group();
  const dotColors = [0xd8ff3e, 0xff5a36, 0xcfe1ff, 0xffffff];
  for (let index = 0; index < 8; index += 1) {
    const dot = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.035 + (index % 3) * 0.012),
      new THREE.MeshBasicMaterial({ color: dotColors[index % dotColors.length] })
    );
    const angle = (index / 8) * Math.PI * 2;
    dot.position.set(Math.cos(angle) * 1.55, 0.95 + Math.sin(angle * 2) * 0.45, Math.sin(angle) * 1.55);
    heroDots.add(dot);
  }
  heroViewer.scene.add(heroDots);

  heroViewer.updates.push((dt) => {
    if (REDUCED) return;
    heroRing.rotation.z += dt * 0.22;
    heroRingTwo.rotation.z -= dt * 0.14;
    heroDots.rotation.y += dt * 0.3;
  });

  function buildFallbackBot() {
    const group = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, metalness: 0.5, roughness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0.7, roughness: 0.25 });
    const acid = new THREE.MeshStandardMaterial({ color: 0xd8ff3e, emissive: 0xd8ff3e, emissiveIntensity: 0.35, metalness: 0.2, roughness: 0.4 });

    const head = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.75, 0.75, 5, 0.16), shell);
    head.position.y = 1.55;
    group.add(head);
    const visor = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.22, 0.06, 4, 0.06), dark);
    visor.position.set(0, 1.6, 0.4);
    group.add(visor);
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.055, 24), acid);
    eye.position.set(0, 1.6, 0.435);
    group.add(eye);

    const body = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.9, 0.58, 5, 0.14), shell);
    body.position.y = 0.72;
    group.add(body);
    const chest = new THREE.Mesh(new THREE.CircleGeometry(0.13, 28), acid);
    chest.position.set(0, 0.82, 0.295);
    group.add(chest);

    [-1, 1].forEach((side) => {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.52, 6, 14), shell);
      arm.position.set(side * 0.57, 0.78, 0);
      arm.rotation.z = side * 0.14;
      group.add(arm);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.42, 6, 14), dark);
      leg.position.set(side * 0.22, 0.2, 0);
      group.add(leg);
    });

    group.traverse((child) => {
      if (child.isMesh) child.castShadow = true;
    });
    return group;
  }

  loadGLB("models/robot.glb")
    .then((gltf) => {
      const model = gltf.scene;
      markShadows(model);
      fitObject(model, { size: 1.62, ground: false });
      model.position.y += 0.86;
      heroViewer.scene.add(model);
      playAnimations(gltf, heroViewer, model);
      heroViewer.updates.push((dt, time) => {
        if (REDUCED) return;
        model.rotation.y += dt * 0.34;
        model.position.y = 0.86 + Math.sin(time * 1.35) * 0.045;
      });
    })
    .catch(() => {
      const bot = buildFallbackBot();
      fitObject(bot, { size: 1.62, ground: false });
      bot.position.y += 0.86;
      heroViewer.scene.add(bot);
      heroViewer.updates.push((dt, time) => {
        if (REDUCED) return;
        bot.rotation.y += dt * 0.34;
        bot.position.y = 0.86 + Math.sin(time * 1.35) * 0.045;
      });
    });

  /* ============================================================
     STUDIO STAGE
     ============================================================ */

  const stageCanvas = $("stage-canvas");
  const stageElement = $("stage");
  const stageLoading = $("stage-loading");
  const stageName = $("stage-name");
  const stageMeta = $("stage-meta");
  const stageType = $("stage-type");
  const presetGrid = $("preset-grid");
  const uploadZone = $("upload-zone");
  const fileInput = $("file-input");
  const uploadTitle = $("upload-title");
  const uploadSub = $("upload-sub");
  const textControls = $("text-controls");
  const svgControls = $("svg-controls");
  const imageControls = $("image-controls");
  const textInput = $("text-input");
  const depthRange = $("depth-range");
  const scaleRange = $("scale-range");
  const scaleOutput = $("scale-output");
  const rotateToggle = $("rotate-toggle");
  const qrImg = $("qr-img");
  const qrEmpty = $("qr-empty");
  const shareLink = $("share-link");
  const publishNote = $("publish-note");
  const publishButton = $("publish-btn");
  const arDialog = $("ar-dialog");
  const arViewer = $("ar-viewer");
  const arTitle = $("ar-title");
  const arOpenLink = $("ar-open-link");

  const stageLoadingMarkup = stageLoading.innerHTML;

  const stageViewer = createViewer(stageCanvas, {
    background: "#f4f1e8",
    fov: 35,
    cameraPosition: [2.15, 1.95, 4.5],
    target: [0, 1.02, 0],
    interactive: true,
    shadows: true,
    minDistance: 1.6,
    maxDistance: 9,
  });
  const stageHolder = new THREE.Group();
  stageViewer.scene.add(stageHolder);
  stageViewer.controls.autoRotate = true;

  const stage = {
    mode: "model",
    preset: null,
    current: null,
    loadId: 0,
    textColor: "#2447ff",
    aiSource: null,
  };

  const BACKGROUNDS = {
    paper: "#f4f1e8",
    blue: "#2447ff",
    acid: "#d8ff3e",
    ink: "#0b0b0c",
  };

  function setStageLoading(loading) {
    if (loading) stageLoading.innerHTML = stageLoadingMarkup;
    stageLoading.classList.toggle("is-hidden", !loading);
  }

  function setStageMeta(name, meta) {
    stageName.textContent = name || "Untitled";
    stageMeta.textContent = meta || "KITE asset";
  }

  function clearStage() {
    stageViewer.mixers.length = 0;
    while (stageHolder.children.length) {
      const child = stageHolder.children.pop();
      disposeObject(child);
    }
    stageHolder.scale.setScalar(1);
    scaleRange.value = "100";
    scaleOutput.textContent = "100%";
  }

  function showStageError(message) {
    setStageLoading(false);
    setStageMeta("Preview unavailable", message || "Try another asset");
  }

  function stageAdd(object, { size = 2.5, ground = true, lift = 0, name, meta, rotationY = 0 } = {}) {
    object.rotation.y += rotationY;
    fitObject(object, { size, ground, lift });
    markShadows(object);
    stageHolder.add(object);
    setStageMeta(name, meta);
    setStageLoading(false);
  }

  function setStageBackground(name) {
    stageViewer.scene.background = new THREE.Color(BACKGROUNDS[name] || BACKGROUNDS.paper);
    stageElement.dataset.bg = name;
  }

  /* ---------- preset rendering ---------- */

  function renderPresets(mode) {
    presetGrid.innerHTML = "";
    const presets = PRESETS[mode] || [];
    presets.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preset";
      button.dataset.id = preset.id;
      button.style.setProperty("--c1", preset.c1);
      button.style.setProperty("--c2", preset.c2);
      button.innerHTML = `
        <span class="preset-thumb">${preset.glyph}</span>
        <strong>${preset.name}</strong>
        <small>${preset.tag}</small>
      `;
      if (stage.preset?.id === preset.id) button.classList.add("is-active");
      button.addEventListener("click", () => selectPreset(preset));
      presetGrid.appendChild(button);
    });
  }

  function setActivePreset(id) {
    $$(".preset", presetGrid).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.id === id);
    });
  }

  function setActiveChip(containerId, key) {
    $$(`#${containerId} .mini-chip`).forEach((button) => {
      const value = button.dataset.svg || button.dataset.poster;
      button.classList.toggle("is-active", value === key);
    });
  }

  function selectPreset(preset) {
    if (!preset) return;
    stage.preset = preset;
    setActivePreset(preset.id);

    if (stage.mode === "text") {
      stage.textColor = preset.color || "#2447ff";
      textInput.value = preset.word || preset.name || "KITE";
      buildText(preset.name);
      return;
    }

    if (stage.mode === "svg") {
      setActiveChip("svg-presets", preset.shape);
      buildSvg(preset.shape, preset.name);
      return;
    }

    if (stage.mode === "image" || stage.mode === "picture") {
      if (stage.mode === "image") setActiveChip("image-presets", preset.art);
      buildPoster(preset.art, stage.mode === "picture", preset.name, preset.meta);
      return;
    }

    loadModelPreset(preset);
  }

  function setMode(mode, { autoLoad = true } = {}) {
    const config = MODES[mode];
    if (!config) return;
    stage.mode = mode;

    $$(".type-tab").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === mode);
    });

    stageType.textContent = config.type;
    $("content-title").textContent = config.title;
    uploadZone.hidden = !config.upload;
    if (config.upload) {
      fileInput.accept = config.accept;
      uploadTitle.textContent = config.uploadTitle;
      uploadSub.textContent = config.uploadSub;
    }
    textControls.hidden = mode !== "text";
    svgControls.hidden = mode !== "svg";
    imageControls.hidden = !(mode === "image" || mode === "picture");
    presetGrid.hidden = false;

    renderPresets(mode);

    if (autoLoad) {
      const first = PRESETS[mode][0];
      if (first) selectPreset(first);
    }
  }

  /* ---------- model loading ---------- */

  async function loadModelPreset(preset) {
    const loadId = ++stage.loadId;
    clearStage();
    setStageLoading(true);
    setStageMeta(preset.name, preset.meta);

    try {
      const gltf = await loadGLB(preset.url);
      if (loadId !== stage.loadId) {
        disposeObject(gltf.scene);
        return;
      }

      const model = gltf.scene;
      const isFace = stage.mode === "face";
      fitObject(model, {
        size: isFace ? 2.35 : 2.5,
        ground: true,
        lift: isFace ? 0.08 : 0,
      });
      markShadows(model);
      stageHolder.add(model);

      playAnimations(gltf, stageViewer, model);

      stage.current = {
        kind: "glb",
        url: preset.url,
        name: preset.name,
        meta: preset.meta,
        presetId: preset.id,
      };
      setStageLoading(false);
    } catch (error) {
      console.error("KITE model load failed", error);
      if (loadId === stage.loadId) showStageError("Could not load this GLB");
    }
  }

  async function handleFile(file) {
    if (!file) return;

    const isSvg = file.type.includes("svg") || file.name.toLowerCase().endsWith(".svg");
    const isImage = file.type.startsWith("image/") && !isSvg;
    const isModel =
      file.name.toLowerCase().endsWith(".glb") ||
      file.name.toLowerCase().endsWith(".gltf") ||
      file.type.includes("gltf");

    if (isSvg) {
      if (stage.mode !== "svg") setMode("svg", { autoLoad: false });
      const text = await file.text();
      buildSvgFromText(text, file.name.replace(/\.[^.]+$/, ""));
      return;
    }

    if (isImage) {
      if (stage.mode !== "image" && stage.mode !== "picture") setMode("image", { autoLoad: false });
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        buildPosterFromImage(image, stage.mode === "picture", file.name.replace(/\.[^.]+$/, ""));
        URL.revokeObjectURL(url);
      };
      image.onerror = () => {
        showStageError("Could not read this image");
        URL.revokeObjectURL(url);
      };
      image.src = url;
      return;
    }

    if (isModel) {
      const loadId = ++stage.loadId;
      clearStage();
      setStageLoading(true);
      setStageMeta(file.name, "Uploaded GLB · local file");
      const url = URL.createObjectURL(file);
      try {
        const gltf = await loadGLB(url);
        if (loadId !== stage.loadId) {
          disposeObject(gltf.scene);
          return;
        }
        fitObject(gltf.scene, { size: 2.5, ground: true });
        markShadows(gltf.scene);
        stageHolder.add(gltf.scene);
        playAnimations(gltf, stageViewer, gltf.scene);
        stage.current = {
          kind: "glb",
          url,
          name: file.name.replace(/\.[^.]+$/, ""),
          meta: "Uploaded GLB · local file",
          presetId: null,
        };
        stage.preset = null;
        setActivePreset(null);
        setStageLoading(false);
      } catch (error) {
        console.error("KITE upload failed", error);
        if (loadId === stage.loadId) showStageError("Could not read this 3D file");
      }
      return;
    }

    showStageError("Unsupported file type");
  }

  /* ---------- 3D text ---------- */

  let fontPromise = null;
  function getFont() {
    if (!fontPromise) {
      fontPromise = new Promise((resolve, reject) => {
        new FontLoader().load(FONT_URL, resolve, undefined, reject);
      });
    }
    return fontPromise;
  }

  let textTimer = null;
  async function buildText(nameOverride) {
    const loadId = ++stage.loadId;
    clearStage();
    setStageLoading(true);

    const label = (textInput.value || "KITE").toUpperCase().slice(0, 16) || "KITE";
    const meta = `3D text · extruded · ${label.length} chars`;
    setStageMeta(nameOverride || label, meta);

    try {
      const font = await getFont();
      if (loadId !== stage.loadId) return;

      const geometry = new TextGeometry(label, {
        font,
        size: 1.05,
        height: Math.max(0.08, parseFloat(depthRange.value) || 0.32),
        curveSegments: 10,
        bevelEnabled: true,
        bevelThickness: 0.018,
        bevelSize: 0.018,
        bevelSegments: 3,
      });
      geometry.center();

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(stage.textColor),
        metalness: 0.38,
        roughness: 0.24,
        envMapIntensity: 1.1,
      });
      const mesh = new THREE.Mesh(geometry, material);

      stageAdd(mesh, {
        size: 2.12,
        ground: true,
        lift: 0.18,
        name: nameOverride || label,
        meta,
      });

      stage.current = {
        kind: "object",
        object: mesh,
        name: nameOverride || label,
        meta,
        presetId: null,
      };
    } catch (error) {
      console.error("KITE text build failed", error);
      if (loadId === stage.loadId) showStageError("Could not load the 3D font");
    }
  }

  function scheduleTextBuild() {
    clearTimeout(textTimer);
    textTimer = setTimeout(() => {
      stage.preset = null;
      setActivePreset(null);
      buildText();
    }, 220);
  }

  /* ---------- SVG to 3D ---------- */

  const SVG_PATHS = {
    star: "M50 4 L61.8 35.6 L96 36.4 L68.8 57.4 L78.4 91.2 L50 71.6 L21.6 91.2 L31.2 57.4 L4 36.4 L38.2 35.6 Z",
    bolt: "M58 3 L17 55 L43 55 L33 97 L84 41 L56 41 Z",
    kite: "M50 3 L93 38 L50 97 L7 38 Z",
    ring: "M50 8 A42 42 0 1 0 50 92 A42 42 0 1 0 50 8 Z M50 30 A20 20 0 1 1 50 70 A20 20 0 1 1 50 30 Z",
  };

  function svgMarkup(shape) {
    const path = SVG_PATHS[shape] || SVG_PATHS.star;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${path}" fill-rule="evenodd"/></svg>`;
  }

  function shapesFromSvg(text) {
    const data = new SVGLoader().parse(text);
    const shapes = [];
    data.paths.forEach((path) => {
      shapes.push(...SVGLoader.createShapes(path));
    });
    return shapes;
  }

  function svgMaterial(shape) {
    if (shape === "ring") {
      return new THREE.MeshStandardMaterial({ color: 0xffc94a, metalness: 1, roughness: 0.18, side: THREE.DoubleSide });
    }
    if (shape === "bolt") {
      return new THREE.MeshStandardMaterial({ color: 0xff5a36, metalness: 0.35, roughness: 0.28, side: THREE.DoubleSide });
    }
    if (shape === "kite") {
      return new THREE.MeshStandardMaterial({ color: 0x2447ff, metalness: 0.4, roughness: 0.26, side: THREE.DoubleSide });
    }
    return new THREE.MeshStandardMaterial({ color: 0xd8ff3e, metalness: 0.35, roughness: 0.3, side: THREE.DoubleSide });
  }

  function buildSvg(shape, name) {
    const loadId = ++stage.loadId;
    clearStage();
    setStageLoading(true);
    setStageMeta(name || "SVG shape", `SVG to 3D · extruded · ${shape}`);

    try {
      const shapes = shapesFromSvg(svgMarkup(shape));
      if (!shapes.length) throw new Error("No shapes found");

      const material = svgMaterial(shape);
      const group = new THREE.Group();
      shapes.forEach((svgShape) => {
        const geometry = new THREE.ExtrudeGeometry(svgShape, {
          depth: 0.34,
          curveSegments: 8,
          bevelEnabled: true,
          bevelThickness: 0.02,
          bevelSize: 0.02,
          bevelSegments: 2,
        });
        geometry.scale(1, -1, 1);
        const mesh = new THREE.Mesh(geometry, material);
        group.add(mesh);
      });

      stageAdd(group, {
        size: 2.2,
        ground: true,
        lift: 0.12,
        name: name || "SVG shape",
        meta: `SVG to 3D · extruded · ${shape}`,
        rotationY: -0.38,
      });

      stage.current = {
        kind: "object",
        object: group,
        name: name || "SVG shape",
        meta: `SVG to 3D · extruded · ${shape}`,
        presetId: null,
      };
    } catch (error) {
      console.error("KITE SVG build failed", error);
      if (loadId === stage.loadId) showStageError("Could not read this SVG");
    }
  }

  function buildSvgFromText(text, name) {
    const loadId = ++stage.loadId;
    clearStage();
    setStageLoading(true);
    setStageMeta(name || "Uploaded SVG", "SVG to 3D · local file");

    try {
      const shapes = shapesFromSvg(text);
      if (!shapes.length) throw new Error("No shapes found");

      const group = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({
        color: 0x2447ff,
        metalness: 0.42,
        roughness: 0.25,
        side: THREE.DoubleSide,
      });
      shapes.forEach((svgShape) => {
        const geometry = new THREE.ExtrudeGeometry(svgShape, {
          depth: 0.3,
          curveSegments: 8,
          bevelEnabled: true,
          bevelThickness: 0.018,
          bevelSize: 0.018,
          bevelSegments: 2,
        });
        geometry.scale(1, -1, 1);
        group.add(new THREE.Mesh(geometry, material));
      });

      stageAdd(group, {
        size: 2.2,
        ground: true,
        lift: 0.12,
        name: name || "Uploaded SVG",
        meta: "SVG to 3D · local file",
        rotationY: -0.38,
      });

      stage.preset = null;
      setActivePreset(null);
      stage.current = {
        kind: "object",
        object: group,
        name: name || "Uploaded SVG",
        meta: "SVG to 3D · local file",
        presetId: null,
      };
    } catch (error) {
      console.error("KITE SVG upload failed", error);
      if (loadId === stage.loadId) showStageError("Could not read this SVG");
    }
  }

  /* ---------- posters & frames ---------- */

  function artCanvas(kind) {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1200;
    const context = canvas.getContext("2d");
    const paper = "#f4f1e8";
    const ink = "#0b0b0c";
    const blue = "#2447ff";
    const acid = "#d8ff3e";
    const coral = "#ff5a36";
    const sky = "#cfe1ff";

    const grid = (color, step = 75, alpha = 0.16) => {
      context.save();
      context.globalAlpha = alpha;
      context.strokeStyle = color;
      context.lineWidth = 2;
      for (let x = 0; x <= canvas.width; x += step) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
        context.stroke();
      }
      for (let y = 0; y <= canvas.height; y += step) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvas.width, y);
        context.stroke();
      }
      context.restore();
    };

    const label = (text, x, y, color = ink, size = 34, align = "left") => {
      context.save();
      context.fillStyle = color;
      context.font = `600 ${size}px "JetBrains Mono", monospace`;
      context.textAlign = align;
      context.fillText(text, x, y);
      context.restore();
    };

    if (kind === "kite") {
      context.fillStyle = paper;
      context.fillRect(0, 0, canvas.width, canvas.height);
      grid(ink);
      context.save();
      context.translate(450, 470);
      context.rotate(-0.12);
      context.fillStyle = blue;
      context.beginPath();
      context.moveTo(0, -300);
      context.lineTo(270, 0);
      context.lineTo(0, 300);
      context.lineTo(-270, 0);
      context.closePath();
      context.fill();
      context.fillStyle = acid;
      context.beginPath();
      context.moveTo(0, -170);
      context.lineTo(150, 0);
      context.lineTo(0, 170);
      context.lineTo(-150, 0);
      context.closePath();
      context.fill();
      context.strokeStyle = ink;
      context.lineWidth = 10;
      context.beginPath();
      context.moveTo(0, 300);
      context.quadraticCurveTo(110, 380, 40, 520);
      context.stroke();
      context.restore();
      context.fillStyle = ink;
      context.font = '800 150px "Bricolage Grotesque", Arial, sans-serif';
      context.fillText("KITE", 56, 1080);
      label("REALITY / REMIXED", 60, 1140, "#5d5a52", 24);
    } else if (kind === "grid") {
      context.fillStyle = blue;
      context.fillRect(0, 0, canvas.width, canvas.height);
      grid(acid, 90, 0.3);
      context.fillStyle = coral;
      context.beginPath();
      context.arc(470, 500, 260, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = acid;
      context.fillRect(150, 760, 600, 120);
      context.fillStyle = ink;
      context.font = '800 130px "Bricolage Grotesque", Arial, sans-serif';
      context.fillText("GRID", 56, 1080);
      label("STUDY / 06", 60, 1140, paper, 24);
    } else if (kind === "sun") {
      const gradient = context.createLinearGradient(0, 0, 900, 1200);
      gradient.addColorStop(0, coral);
      gradient.addColorStop(1, acid);
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.translate(450, 480);
      for (let index = 0; index < 16; index += 1) {
        context.rotate(Math.PI / 8);
        context.fillStyle = index % 2 ? paper : ink;
        context.fillRect(-9, 0, 18, 400);
      }
      context.restore();
      context.fillStyle = paper;
      context.beginPath();
      context.arc(450, 480, 230, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = coral;
      context.beginPath();
      context.arc(450, 480, 150, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = ink;
      context.font = '800 130px "Bricolage Grotesque", Arial, sans-serif';
      context.fillText("SUN", 56, 1080);
      label("PRINT / 03", 60, 1140, paper, 24);
    } else if (kind === "gallery") {
      context.fillStyle = paper;
      context.fillRect(0, 0, canvas.width, canvas.height);
      grid(ink, 100, 0.1);
      context.fillStyle = blue;
      context.beginPath();
      context.moveTo(190, 900);
      context.lineTo(190, 380);
      context.arc(450, 380, 260, Math.PI, 0);
      context.lineTo(710, 900);
      context.closePath();
      context.fill();
      context.fillStyle = coral;
      context.beginPath();
      context.arc(450, 640, 140, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = acid;
      context.fillRect(120, 900, 660, 26);
      context.fillStyle = ink;
      context.font = '800 120px "Bricolage Grotesque", Arial, sans-serif';
      context.fillText("FORM", 56, 1080);
      label("OBJECT / 01", 60, 1140, "#5d5a52", 24);
    } else if (kind === "type") {
      context.fillStyle = ink;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = acid;
      context.font = '800 520px "Bricolage Grotesque", Arial, sans-serif';
      context.fillText("A", 60, 600);
      context.fillStyle = coral;
      context.font = '800 330px "Bricolage Grotesque", Arial, sans-serif';
      context.fillText("a", 560, 600);
      context.fillStyle = paper;
      context.font = '800 110px "Bricolage Grotesque", Arial, sans-serif';
      context.fillText("TYPE", 56, 900);
      label("SPECIMEN / 02", 60, 1140, acid, 24);
    } else {
      context.fillStyle = blue;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = acid;
      context.lineWidth = 8;
      [180, 280, 380].forEach((radius) => {
        context.beginPath();
        context.arc(450, 500, radius, 0, Math.PI * 2);
        context.stroke();
      });
      context.fillStyle = paper;
      context.beginPath();
      context.arc(450, 500, 90, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = coral;
      context.beginPath();
      context.arc(730, 270, 34, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = paper;
      context.font = '800 120px "Bricolage Grotesque", Arial, sans-serif';
      context.fillText("ORBIT", 56, 1080);
      label("SYSTEM / 03", 60, 1140, sky, 24);
    }

    return canvas;
  }

  function makeFrameGroup(texture, aspect, framed) {
    const group = new THREE.Group();
    const height = 2.4;
    const width = Math.min(3.1, Math.max(1.2, height * aspect));

    const artMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.82,
      metalness: 0.02,
    });
    const art = new THREE.Mesh(new THREE.PlaneGeometry(width, height), artMaterial);
    art.position.z = 0.04;
    group.add(art);

    const back = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.07, height + 0.07, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9 })
    );
    group.add(back);

    if (framed) {
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.3, height + 0.3, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.5, metalness: 0.15 })
      );
      frame.position.z = 0.02;
      group.add(frame);

      const matte = new THREE.Mesh(
        new THREE.PlaneGeometry(width + 0.12, height + 0.12),
        new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 1 })
      );
      matte.position.z = 0.11;
      group.add(matte);

      art.position.z = 0.13;
      art.scale.set(0.92, 0.92, 1);

      const wire = new THREE.Mesh(
        new THREE.TorusGeometry(0.09, 0.012, 6, 28, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0xd8ff3e, metalness: 0.9, roughness: 0.25 })
      );
      wire.position.set(0, height / 2 + 0.19, 0.02);
      wire.rotation.z = Math.PI;
      group.add(wire);
    }

    return group;
  }

  function buildPoster(kind, framed, name, meta) {
    const loadId = ++stage.loadId;
    clearStage();
    setStageLoading(true);
    setStageMeta(name || "Poster", meta || "Image AR · poster");

    const canvas = artCanvas(kind);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = stageViewer.renderer.capabilities.getMaxAnisotropy();

    const group = makeFrameGroup(texture, canvas.width / canvas.height, framed);
    stageAdd(group, {
      size: 2.55,
      ground: false,
      lift: 1.24,
      name: name || "Poster",
      meta: meta || (framed ? "Picture frame · wall art" : "Image AR · poster"),
      rotationY: -0.08,
    });

    stage.current = {
      kind: "object",
      object: group,
      name: name || "Poster",
      meta: meta || "Image AR · poster",
      presetId: null,
    };
    if (loadId !== stage.loadId) return;
  }

  function buildPosterFromImage(image, framed, name) {
    const loadId = ++stage.loadId;
    clearStage();
    setStageLoading(true);
    setStageMeta(name || "Uploaded image", framed ? "Picture frame · local image" : "Image AR · local image");

    const texture = new THREE.Texture(image);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = stageViewer.renderer.capabilities.getMaxAnisotropy();

    const aspect = (image.naturalWidth || image.width) / (image.naturalHeight || image.height) || 1;
    const group = makeFrameGroup(texture, aspect, framed);
    stageAdd(group, {
      size: 2.55,
      ground: false,
      lift: 1.24,
      name: name || "Uploaded image",
      meta: framed ? "Picture frame · local image" : "Image AR · local image",
      rotationY: -0.08,
    });

    stage.preset = null;
    setActivePreset(null);
    stage.current = {
      kind: "object",
      object: group,
      name: name || "Uploaded image",
      meta: framed ? "Picture frame · local image" : "Image AR · local image",
      presetId: null,
    };
    if (loadId !== stage.loadId) return;
  }

  /* ---------- export & download ---------- */

  function exportObjectToBlob(object) {
    return new Promise((resolve, reject) => {
      const exporter = new GLTFExporter();
      exporter.parse(
        object,
        (result) => {
          if (result instanceof ArrayBuffer) {
            resolve(new Blob([result], { type: "model/gltf-binary" }));
          } else {
            resolve(new Blob([JSON.stringify(result)], { type: "model/gltf+json" }));
          }
        },
        reject,
        { binary: true, onlyVisible: true }
      );
    });
  }

  function downloadBlob(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  async function downloadCurrent() {
    const current = stage.current;
    if (!current) return;
    const filename = `${slugify(current.name)}.glb`;
    let blob = null;

    if (current.kind === "glb") {
      try {
        const response = await fetch(current.url);
        blob = await response.blob();
      } catch (error) {
        console.warn("KITE download fallback", error);
      }
    }

    if (!blob && current.object) {
      try {
        blob = await exportObjectToBlob(current.object);
      } catch (error) {
        console.error("KITE export failed", error);
      }
    }

    if (!blob) {
      publishNote.textContent = "Could not export this asset. Try a preset model.";
      return;
    }

    downloadBlob(blob, filename);
    const button = $("download-glb");
    const original = button.textContent;
    button.textContent = "Downloaded ✓";
    setTimeout(() => {
      button.textContent = original;
    }, 1800);
  }

  /* ---------- AR + QR ---------- */

  let arObjectUrl = null;

  async function openAR() {
    const current = stage.current;
    if (!current) return;

    let url = null;
    if (current.kind === "glb") {
      url = current.url;
    } else if (current.object) {
      try {
        const blob = await exportObjectToBlob(current.object);
        if (arObjectUrl) URL.revokeObjectURL(arObjectUrl);
        arObjectUrl = URL.createObjectURL(blob);
        url = arObjectUrl;
      } catch (error) {
        console.error("KITE AR export failed", error);
        publishNote.textContent = "Could not prepare this asset for AR.";
        return;
      }
    }

    if (!url) return;
    arViewer.setAttribute("src", url);
    arViewer.setAttribute("alt", current.name || "AR model preview");
    arTitle.textContent = current.name || "Your experience";

    if (current.presetId) {
      arOpenLink.href = `view.html?model=${encodeURIComponent(current.presetId)}`;
      arOpenLink.hidden = false;
    } else {
      arOpenLink.hidden = true;
    }

    if (typeof arDialog.showModal === "function") {
      if (!arDialog.open) arDialog.showModal();
    } else {
      arDialog.setAttribute("open", "");
    }
  }

  function qrDataUrl(text, cell = 7, margin = 6) {
    if (typeof qrcode !== "function") return null;
    try {
      const code = qrcode(0, "M");
      code.addData(text);
      code.make();
      return code.createDataURL(cell, margin);
    } catch (error) {
      console.error("KITE QR failed", error);
      return null;
    }
  }

  function currentShareUrl() {
    const id = stage.current?.presetId || "chair";
    return new URL(`view.html?model=${encodeURIComponent(id)}`, window.location.href).href;
  }

  function generateQR() {
    const url = currentShareUrl();
    const data = qrDataUrl(url, 7, 5);

    if (data) {
      qrImg.src = data;
      qrImg.hidden = false;
      qrEmpty.hidden = true;
    } else {
      qrImg.hidden = true;
      qrEmpty.hidden = false;
      qrEmpty.querySelector("small").textContent = "QR library unavailable";
    }

    shareLink.value = url;

    if (stage.current?.presetId) {
      publishNote.textContent = `Scan to open “${stage.current.name}” in AR on any phone.`;
    } else {
      publishNote.textContent =
        "QR preview points to the demo chair. Custom assets stay in this browser tab.";
    }

    if (!REDUCED && qrImg.animate) {
      qrImg.animate(
        [
          { transform: "scale(0.96)", opacity: 0.4 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 320, easing: "ease-out" }
      );
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
      } catch (copyError) {
        console.warn("KITE copy failed", copyError);
      }
      textarea.remove();
      return true;
    }
  }

  /* ============================================================
     AI LAB
     ============================================================ */

  const aiCanvas = $("ai-canvas");
  const aiStage = $("ai-stage");
  const aiLoading = $("ai-loading");
  const aiCaption = $("ai-caption");
  const aiName = $("ai-name");
  const aiMaterial = $("ai-material");
  const aiTris = $("ai-tris");
  const aiInput = $("ai-input");

  const aiViewer = createViewer(aiCanvas, {
    alpha: true,
    fov: 35,
    cameraPosition: [0, 1.55, 4.5],
    target: [0, 1.02, 0],
    interactive: true,
    shadows: true,
    minDistance: 1.5,
    maxDistance: 8,
  });
  aiViewer.scene.background = null;
  aiViewer.controls.autoRotate = true;
  aiViewer.controls.autoRotateSpeed = 1.7;

  const aiHolder = new THREE.Group();
  aiViewer.scene.add(aiHolder);

  const aiState = { object: null, token: 0, material: "—" };

  function clearAI() {
    while (aiHolder.children.length) {
      const child = aiHolder.children.pop();
      disposeObject(child);
    }
  }

  function materialForPrompt(prompt) {
    if (/(glass|crystal|transparent|acrylic)/.test(prompt)) {
      return {
        material: new THREE.MeshPhysicalMaterial({
          color: 0xbfe6ff,
          metalness: 0,
          roughness: 0.05,
          transmission: 1,
          transparent: true,
          opacity: 0.8,
          thickness: 0.65,
          ior: 1.45,
          side: THREE.DoubleSide,
        }),
        name: "Glass / transmission",
      };
    }
    if (/(gold|brass|bronze)/.test(prompt)) {
      return {
        material: new THREE.MeshStandardMaterial({ color: 0xffc94a, metalness: 1, roughness: 0.17 }),
        name: "Gold / polished metal",
      };
    }
    if (/(chrome|metal|silver|steel|aluminium|aluminum)/.test(prompt)) {
      return {
        material: new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 1, roughness: 0.1 }),
        name: "Chrome / mirror metal",
      };
    }
    if (/(neon|glow|light|luminous)/.test(prompt)) {
      return {
        material: new THREE.MeshStandardMaterial({
          color: 0x0b0b0c,
          emissive: 0xd8ff3e,
          emissiveIntensity: 1.7,
          metalness: 0.2,
          roughness: 0.4,
        }),
        name: "Neon / emissive",
      };
    }
    if (/(clay|ceramic|matte|stone|concrete)/.test(prompt)) {
      return {
        material: new THREE.MeshStandardMaterial({ color: 0xff8a6a, metalness: 0, roughness: 1 }),
        name: "Clay / matte",
      };
    }
    return {
      material: new THREE.MeshStandardMaterial({ color: 0x2447ff, metalness: 0.45, roughness: 0.28 }),
      name: "Cobalt / PBR",
    };
  }

  function buildChair(material) {
    const group = new THREE.Group();
    const seat = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.2, 1.18, 4, 0.08), material);
    seat.position.y = 0.74;
    group.add(seat);

    const back = new THREE.Mesh(new RoundedBoxGeometry(1.5, 1.08, 0.18, 4, 0.08), material);
    back.position.set(0, 1.33, -0.54);
    back.rotation.x = -0.12;
    group.add(back);

    [-1, 1].forEach((side) => {
      const arm = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.18, 1.06, 3, 0.05), material);
      arm.position.set(side * 0.68, 0.92, -0.02);
      group.add(arm);

      const frontLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.72, 14), material);
      frontLeg.position.set(side * 0.58, 0.36, 0.45);
      group.add(frontLeg);

      const backLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.72, 14), material);
      backLeg.position.set(side * 0.58, 0.36, -0.45);
      group.add(backLeg);
    });
    return group;
  }

  function buildLamp(material) {
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.09, 40), material);
    base.position.y = 0.05;
    group.add(base);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.55, 16), material);
    stem.position.y = 0.84;
    group.add(stem);

    const shadeMaterial = material.clone();
    shadeMaterial.side = THREE.DoubleSide;
    if (shadeMaterial.emissive) shadeMaterial.emissiveIntensity = 1.4;
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.62, 0.55, 40, 1, true), shadeMaterial);
    shade.position.y = 1.68;
    group.add(shade);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd36e, emissiveIntensity: 2.2 })
    );
    bulb.position.y = 1.48;
    group.add(bulb);

    const light = new THREE.PointLight(0xffe3a1, 6, 5.5);
    light.position.y = 1.48;
    group.add(light);
    return group;
  }

  function buildVase(material) {
    const points = [];
    for (let index = 0; index <= 26; index += 1) {
      const t = index / 26;
      const radius = 0.16 + Math.sin(t * Math.PI) * 0.56 - Math.pow(Math.max(0, t - 0.78) / 0.22, 2) * 0.22;
      points.push(new THREE.Vector2(Math.max(0.09, radius), t * 1.9));
    }
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(points, 56), material);
    group.add(mesh);
    return group;
  }

  function buildRing(material) {
    const group = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.15, 26, 90), material);
    band.position.y = 1.0;
    group.add(band);

    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28, 0),
      new THREE.MeshPhysicalMaterial({
        color: 0xd8ff3e,
        metalness: 0.15,
        roughness: 0.05,
        transmission: 0.65,
        transparent: true,
        opacity: 0.92,
        thickness: 0.4,
      })
    );
    gem.position.y = 1.86;
    gem.scale.y = 1.35;
    group.add(gem);
    return group;
  }

  function buildSneaker(material) {
    const group = new THREE.Group();
    const sole = new THREE.Mesh(new RoundedBoxGeometry(1.62, 0.2, 0.72, 4, 0.08), material);
    sole.position.y = 0.12;
    group.add(sole);

    const upper = new THREE.Mesh(new RoundedBoxGeometry(1.08, 0.5, 0.64, 4, 0.14), material);
    upper.position.set(0.16, 0.42, 0);
    group.add(upper);

    const toe = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.34, 0.58, 4, 0.13), material);
    toe.position.set(-0.48, 0.32, 0);
    group.add(toe);

    for (let index = 0; index < 3; index += 1) {
      const lace = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.025, 0.04),
        new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.7 })
      );
      lace.position.set(0.12, 0.62, -0.16 + index * 0.16);
      group.add(lace);
    }
    return group;
  }

  function buildTable(material) {
    const group = new THREE.Group();
    const top = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.13, 1.05, 4, 0.06), material);
    top.position.y = 0.92;
    group.add(top);
    [-1, 1].forEach((x) => {
      [-1, 1].forEach((z) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.9, 14), material);
        leg.position.set(x * 0.7, 0.45, z * 0.4);
        group.add(leg);
      });
    });
    return group;
  }

  function buildSculpture(material) {
    const group = new THREE.Group();
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.64, 0.2, 160, 26), material);
    knot.position.y = 1.05;
    group.add(knot);
    return group;
  }

  function buildPromptObject(prompt) {
    const text = prompt.toLowerCase();
    const { material, name: materialName } = materialForPrompt(text);
    let group;
    let name;

    if (/(chair|lounge|seat|sofa|armchair)/.test(text)) {
      group = buildChair(material);
      name = "Lounge chair";
    } else if (/(lamp|light|bulb|lantern)/.test(text)) {
      group = buildLamp(material);
      name = "Table lamp";
    } else if (/(vase|pot|bottle|vessel)/.test(text)) {
      group = buildVase(material);
      name = "Sculptural vase";
    } else if (/(ring|jewel|diamond|gem)/.test(text)) {
      group = buildRing(material);
      name = "Signet ring";
    } else if (/(sneaker|shoe|trainer|boot)/.test(text)) {
      group = buildSneaker(material);
      name = "Clay sneaker";
    } else if (/(table|desk|counter)/.test(text)) {
      group = buildTable(material);
      name = "Side table";
    } else {
      group = buildSculpture(material);
      name = "Abstract form";
    }

    return { group, name, materialName };
  }

  async function generateAI(prompt) {
    const token = ++aiState.token;
    aiLoading.classList.remove("is-hidden");
    aiCaption.textContent = `“${prompt}”`;

    await wait(REDUCED ? 80 : 560 + Math.random() * 380);
    if (token !== aiState.token) return;

    clearAI();
    const { group, name, materialName } = buildPromptObject(prompt);
    fitObject(group, { size: 2.45, ground: true, lift: 0.04 });
    markShadows(group);
    aiHolder.add(group);

    aiState.object = group;
    aiState.material = materialName;
    aiCaption.textContent = `${name} · ready to place`;
    aiName.textContent = name;
    aiMaterial.textContent = materialName;
    aiTris.textContent = countTriangles(group).toLocaleString();
    aiLoading.classList.add("is-hidden");
  }

  function bootAIPlaceholder() {
    const placeholder = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.62, 0.19, 140, 22),
      new THREE.MeshStandardMaterial({ color: 0x2447ff, metalness: 0.75, roughness: 0.2 })
    );
    fitObject(placeholder, { size: 2.1, ground: false, lift: 1.12 });
    aiHolder.add(placeholder);
    aiState.object = placeholder;
  }

  /* ============================================================
     UI WIRING
     ============================================================ */

  // Reveal-on-scroll
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -40px" }
  );
  $$(".reveal").forEach((element) => revealObserver.observe(element));

  // Mobile menu
  const menuButton = $("menu-btn");
  const siteNav = $("site-nav");
  menuButton?.addEventListener("click", () => {
    const open = siteNav.classList.toggle("is-open");
    menuButton.setAttribute("aria-expanded", String(open));
  });
  $$("#site-nav a").forEach((link) => {
    link.addEventListener("click", () => {
      siteNav.classList.remove("is-open");
      menuButton?.setAttribute("aria-expanded", "false");
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      siteNav.classList.remove("is-open");
      menuButton?.setAttribute("aria-expanded", "false");
    }
  });

  // Mode tabs
  $$(".type-tab").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  // Suite links
  $$(".suite-link").forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.mode);
      $("studio").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // Gallery
  $$(".gallery-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.model;
      const faceMode = id === "face" || id === "helmet";
      const mode = faceMode ? "face" : "model";
      const preset = [...PRESETS.model, ...PRESETS.face].find((item) => item.id === id);
      setMode(mode, { autoLoad: false });
      if (preset) selectPreset(preset);
      $("studio").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // Background swatches
  $$("#bg-swatches .swatch").forEach((button) => {
    button.addEventListener("click", () => {
      $$("#bg-swatches .swatch").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      setStageBackground(button.dataset.bg);
    });
  });

  // Scale
  scaleRange.addEventListener("input", () => {
    const scale = Number(scaleRange.value) / 100;
    stageHolder.scale.setScalar(scale);
    scaleOutput.textContent = `${scaleRange.value}%`;
  });

  // Auto-rotate
  rotateToggle.addEventListener("change", () => {
    stageViewer.controls.autoRotate = rotateToggle.checked;
  });

  // Reset camera
  $("reset-view").addEventListener("click", () => stageViewer.resetCamera());
  $("stage-reset").addEventListener("click", () => stageViewer.resetCamera());

  // Fullscreen
  $("stage-full").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stageElement.requestFullscreen();
      }
    } catch (error) {
      console.warn("KITE fullscreen unavailable", error);
    }
  });

  // Upload zone
  uploadZone.addEventListener("click", () => fileInput.click());
  uploadZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    handleFile(fileInput.files?.[0]);
    fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach((type) => {
    uploadZone.addEventListener(type, (event) => {
      event.preventDefault();
      uploadZone.classList.add("is-drag");
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    uploadZone.addEventListener(type, (event) => {
      event.preventDefault();
      uploadZone.classList.remove("is-drag");
    });
  });
  uploadZone.addEventListener("drop", (event) => {
    handleFile(event.dataTransfer?.files?.[0]);
  });

  // Text controls
  textInput.addEventListener("input", () => {
    textInput.value = textInput.value.toUpperCase();
    scheduleTextBuild();
  });
  depthRange.addEventListener("input", scheduleTextBuild);

  // SVG presets
  $$("#svg-presets .mini-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const shape = button.dataset.svg;
      $$("#svg-presets .mini-chip").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      stage.preset = null;
      setActivePreset(null);
      buildSvg(shape, button.textContent.trim());
    });
  });
  $("svg-upload-btn").addEventListener("click", () => {
    stage.mode = "svg";
    fileInput.accept = ".svg,image/svg+xml";
    fileInput.click();
  });

  // Image presets
  $$("#image-presets .mini-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const art = button.dataset.poster;
      $$("#image-presets .mini-chip").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      stage.preset = null;
      setActivePreset(null);
      buildPoster(art, stage.mode === "picture", button.textContent.trim(), stage.mode === "picture" ? "Picture frame · wall art" : "Image AR · poster");
    });
  });
  $("image-upload-btn").addEventListener("click", () => {
    fileInput.accept = "image/*";
    fileInput.click();
  });

  // Stage actions
  $("view-ar").addEventListener("click", openAR);
  $("generate-qr").addEventListener("click", generateQR);
  $("download-glb").addEventListener("click", downloadCurrent);

  // Publish panel
  $("copy-link").addEventListener("click", async () => {
    const button = $("copy-link");
    const original = button.textContent;
    await copyText(shareLink.value);
    button.textContent = "✓";
    setTimeout(() => {
      button.textContent = original;
    }, 1400);
  });
  publishButton.addEventListener("click", () => {
    generateQR();
    publishNote.textContent = "Published! Scan the code or copy the link. Unlimited scans, no app.";
    const original = publishButton.textContent;
    publishButton.textContent = "Published ✓";
    setTimeout(() => {
      publishButton.textContent = original;
    }, 2200);
    if (!REDUCED && qrImg.animate) {
      qrImg.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.05)" },
          { transform: "scale(1)" },
        ],
        { duration: 480, easing: "ease-out" }
      );
    }
  });

  // AR dialog
  $("ar-close").addEventListener("click", () => arDialog.close());
  arDialog.addEventListener("click", (event) => {
    if (event.target === arDialog) arDialog.close();
  });
  arDialog.addEventListener("close", () => {
    // Keep the last model loaded so reopening is instant.
  });

  // AI lab
  $("ai-generate").addEventListener("click", () => {
    const prompt = aiInput.value.trim() || "a chrome lounge chair";
    aiInput.value = prompt;
    generateAI(prompt);
  });
  aiInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("ai-generate").click();
    }
  });
  $$("#ai-chips button").forEach((button) => {
    button.addEventListener("click", () => {
      aiInput.value = button.textContent.trim();
      generateAI(aiInput.value);
    });
  });

  const aiSend = $("ai-send");
  aiSend?.addEventListener("click", () => {
    if (!aiState.object) return;
    const copy = cloneWithMaterials(aiState.object);
    setMode("model", { autoLoad: false });
    clearStage();
    stageAdd(copy, {
      size: 2.45,
      ground: true,
      lift: 0.04,
      name: aiName.textContent,
      meta: "AI asset · procedural · sent to studio",
      rotationY: 0.2,
    });
    stage.current = {
      kind: "object",
      object: copy,
      name: aiName.textContent,
      meta: "AI asset · procedural · sent to studio",
      presetId: null,
    };
    stage.preset = null;
    setActivePreset(null);
    $("studio").scrollIntoView({ behavior: "smooth", block: "start" });
    publishNote.textContent = "AI asset loaded into the studio. Generate a QR to publish.";
  });

  // Smooth anchor for the header CTA / hero buttons
  $$('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const id = link.getAttribute("href").slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `#${id}`);
    });
  });

  /* ============================================================
     BOOT
     ============================================================ */

  bootAIPlaceholder();

  // Hero QR — points at the share page for the robot.
  const heroQrImage = $("hero-qr");
  const heroQrData = qrDataUrl(new URL("view.html?model=robot", window.location.href).href, 4, 3);
  if (heroQrData) {
    heroQrImage.src = heroQrData;
  } else {
    heroQrImage.closest(".float-qr")?.remove();
  }

  // Default publish link
  shareLink.value = new URL("view.html?model=chair", window.location.href).href;

  // Initial mode
  setMode("model");
  setStageBackground("paper");

  // Let the first frame paint before revealing.
  requestAnimationFrame(() => {
    document.body.classList.add("is-ready");
  });

  requestAnimationFrame(tick);

  // Exposed for lightweight debugging in the browser console.
  window.__kite = { stage, stageHolder, stageViewer, aiHolder, aiViewer, heroViewer };
})();
