/* Spinning dotted earth — three.js + real continents from world-atlas topojson.
 *
 * Pipeline:
 *   1. Load Natural Earth 110m countries (topojson) from CDN.
 *   2. Rasterize all land polygons onto a hidden equirectangular canvas.
 *   3. Distribute points on a Fibonacci sphere; keep only those whose
 *      corresponding lat/lon pixel on the canvas is "land".
 *   4. Render as a Points cloud in white.
 */

import * as THREE from "https://esm.sh/three@0.160.0";
import * as topojson from "https://esm.sh/topojson-client@3.1.0";

const stage = document.getElementById("earth");
if (stage && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  initEarth(stage).catch((err) => console.error("[earth] init failed:", err));
}

async function initEarth(container) {
  // ---- 1. Build land mask from world-atlas topojson ----
  const MASK_W = 1024;
  const MASK_H = 512;
  const mask = await buildLandMask(MASK_W, MASK_H);

  // ---- 2. Three.js setup ----
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

  // ---- Globe core (subtle, near-invisible sphere for depth occlusion) ----
  const coreGeo = new THREE.SphereGeometry(1.6, 64, 64);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0x150330,
    transparent: true,
    opacity: 0.6,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  scene.add(core);

  // Subtle violet rim glow
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
        gl_FragColor = vec4(0.49, 0.30, 0.84, 1.0) * intensity;
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  scene.add(rim);

  // ---- 3. Fibonacci sphere of dots, keep only land points ----
  const RADIUS = 1.6;
  const COUNT = 18000;       // dense sample to make continents read clearly after masking
  const positions = [];
  const sizes = [];

  for (let i = 0; i < COUNT; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / COUNT);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;

    const sx = Math.sin(phi) * Math.cos(theta);
    const sy = Math.sin(phi) * Math.sin(theta);
    const sz = Math.cos(phi);

    // Convert sphere coordinates to lat/lon
    const lat = 90 - (phi * 180 / Math.PI);                // -90..90
    let lon = ((theta * 180 / Math.PI) % 360);             // 0..360
    if (lon > 180) lon -= 360;                             // -180..180

    if (sampleLand(mask, lon, lat)) {
      // Map sphere coordinate (Y is up in three.js) — keep math straightforward.
      // y = sin(lat); xz on equator plane rotated by lon.
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
        // Far dots (back of globe) dimmer + slightly tinted lavender
        float depthFade = smoothstep(8.0, 4.0, vDepth);
        vec3 col = mix(uColor2, uColor, depthFade);
        gl_FragColor = vec4(col, fade * (0.30 + 0.70 * depthFade));
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const dots = new THREE.Points(dotGeo, dotMat);

  // ---- 4. Decorative orbital ring (subtle violet) ----
  const ringGeo = new THREE.RingGeometry(2.4, 2.42, 128);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7c4dd6,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.35,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2.6;
  scene.add(ring);

  const group = new THREE.Group();
  group.add(core, rim, dots);
  scene.add(group);

  // ---- Animate ----
  let raf;
  const clock = new THREE.Clock();
  function animate() {
    const dt = clock.getDelta();
    group.rotation.y += dt * 0.18;
    ring.rotation.z += dt * 0.05;
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

  const project = (lon, lat) => {
    const x = ((lon + 180) / 360) * W;
    const y = ((90 - lat) / 180) * H;
    return [x, y];
  };

  const drawRing = (ring) => {
    if (ring.length < 3) return;
    ctx.beginPath();
    const [lon0, lat0] = ring[0];
    const [x0, y0] = project(lon0, lat0);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < ring.length; i++) {
      const [lon, lat] = ring[i];
      const [x, y] = project(lon, lat);
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
