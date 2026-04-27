/* Spinning dotted earth — three.js + real continents from world-atlas topojson.
 *
 * Pipeline:
 *   1. Load Natural Earth 110m land topojson from CDN.
 *   2. Rasterize all land polygons onto a hidden equirectangular canvas.
 *   3. Distribute points on a Fibonacci sphere; keep only land points.
 *   4. Render as a Points cloud in white, with proper 23.5° axial tilt
 *      (nested groups: outer = tilt, inner = spin).
 */

import * as THREE from "https://esm.sh/three@0.160.0";
import * as topojson from "https://esm.sh/topojson-client@3.1.0";

const stage = document.getElementById("earth");
if (stage && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  initEarth(stage).catch((err) => console.error("[earth] init failed:", err));
}

async function initEarth(container) {
  const MASK_W = 1024;
  const MASK_H = 512;
  const mask = await buildLandMask(MASK_W, MASK_H);

  const width = container.clientWidth;
  const height = container.clientHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 0, 6);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  // ---- Globe core (subtle dark sphere for depth occlusion) ----
  const coreGeo = new THREE.SphereGeometry(1.6, 64, 64);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0x15123a,
    transparent: true,
    opacity: 0.65,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);

  // Subtle violet rim glow (atmosphere look)
  const rimGeo = new THREE.SphereGeometry(1.62, 64, 64);
  const rimMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        float intensity = pow(0.55 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.5);
        gl_FragColor = vec4(0.55, 0.18, 0.85, 1.0) * intensity;
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const rim = new THREE.Mesh(rimGeo, rimMat);

  // ---- Fibonacci sphere of dots, keep only land points ----
  const RADIUS = 1.6;
  const COUNT = 18000;
  const positions = [];
  const sizes = [];

  for (let i = 0; i < COUNT; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / COUNT);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;

    const lat = 90 - (phi * 180 / Math.PI);
    let lon = ((theta * 180 / Math.PI) % 360);
    if (lon > 180) lon -= 360;

    if (sampleLand(mask, lon, lat)) {
      const latR = lat * Math.PI / 180;
      const lonR = lon * Math.PI / 180;
      const y = Math.sin(latR) * RADIUS;
      const r = Math.cos(latR) * RADIUS;
      const x = r * Math.cos(lonR);
      const z = r * Math.sin(lonR);
      positions.push(x, y, z);
      sizes.push(0.045 + Math.random() * 0.02);
    }
  }

  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  dotGeo.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));

  const dotMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xffffff) },
      uColor2: { value: new THREE.Color(0xd4c5ee) },
    },
    vertexShader: `
      attribute float size;
      varying float vDepth;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mvPosition.z;
        gl_PointSize = size * (320.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uColor2;
      varying float vDepth;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float fade = smoothstep(0.5, 0.0, d);
        float depthFade = smoothstep(8.0, 4.0, vDepth);
        vec3 col = mix(uColor2, uColor, depthFade);
        gl_FragColor = vec4(col, fade * (0.30 + 0.70 * depthFade));
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const dots = new THREE.Points(dotGeo, dotMat);

  // Nested groups: outer applies axial tilt, inner spins around the tilted Y axis.
  // Earth's real axial tilt is 23.5°.
  const tiltGroup = new THREE.Group();
  tiltGroup.rotation.z = (23.5 * Math.PI) / 180;
  scene.add(tiltGroup);

  const spinGroup = new THREE.Group();
  spinGroup.add(core, rim, dots);
  // Start oriented to bring Australia into view (lon ≈ 135°E)
  spinGroup.rotation.y = -(135 * Math.PI) / 180;
  tiltGroup.add(spinGroup);

  // ---- Animate ----
  let raf;
  const clock = new THREE.Clock();
  function animate() {
    const dt = clock.getDelta();
    spinGroup.rotation.y += dt * 0.16;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(animate);
  }
  animate();

  // ---- Resize ----
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ro.observe(container);

  // Pause when off-screen to save battery
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        if (!raf) animate();
      } else {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }
  });
  io.observe(container);
}

/* ----------------------------------------------------------------
   Land-mask generation: fetch world-atlas topojson, render all land
   polygons to a hidden equirectangular canvas, return its image data.
   ---------------------------------------------------------------- */
async function buildLandMask(W, H) {
  const url = "https://esm.sh/world-atlas@2.0.2/land-110m.json";
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`world-atlas fetch failed: ${resp.status}`);
  const topo = await resp.json();
  const land = topojson.feature(topo, topo.objects.land);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff";

  const project = (lon, lat) => [
    ((lon + 180) / 360) * W,
    ((90 - lat) / 180) * H,
  ];

  const drawRing = (ring) => {
    if (ring.length < 3) return;
    ctx.beginPath();
    const [x0, y0] = project(ring[0][0], ring[0][1]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = project(ring[i][0], ring[i][1]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };

  const drawGeometry = (geom) => {
    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates) drawRing(ring);
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        for (const ring of poly) drawRing(ring);
      }
    }
  };

  if (land.type === "FeatureCollection") {
    for (const f of land.features) drawGeometry(f.geometry);
  } else if (land.type === "Feature") {
    drawGeometry(land.geometry);
  } else {
    drawGeometry(land);
  }

  return {
    width: W,
    height: H,
    data: ctx.getImageData(0, 0, W, H).data,
  };
}

function sampleLand(mask, lon, lat) {
  const x = Math.floor(((lon + 180) / 360) * mask.width) % mask.width;
  const y = Math.max(0, Math.min(mask.height - 1, Math.floor(((90 - lat) / 180) * mask.height)));
  const idx = (y * mask.width + x) * 4;
  return mask.data[idx] > 128;
}
