/* Spinning dotted earth — Fibonacci sphere + topojson land mask.
 *
 * Why Fibonacci instead of globe.gl/H3?
 *   The H3 hexagonal grid that globe.gl uses creates visible diagonal
 *   "swirl" patterns (Moiré) inside large landmasses. A Fibonacci
 *   spiral places points with deterministic uniformity and the golden
 *   angle, so there is no regular grid for the eye to lock onto —
 *   continents read as smooth dot clouds.
 *
 * Pipeline:
 *   1. Fetch Natural Earth 50m land topojson.
 *   2. Rasterise to a hidden equirectangular canvas (land = white).
 *   3. Distribute N points on a Fibonacci sphere; keep only those that
 *      sample as land.
 *   4. Render as a Points cloud, with a dark sphere underneath for
 *      depth occlusion and a violet rim glow for atmosphere.
 *   5. Apply Earth's natural 23.5° axial tilt and auto-rotate.
 */

import * as THREE from "https://esm.sh/three@0.160.0";
import * as topojson from "https://esm.sh/topojson-client@3.1.0";

const stage = document.getElementById("earth");
if (stage && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  initEarth(stage).catch((err) => console.error("[earth] init failed:", err));
}

async function initEarth(container) {
  // Land mask — 50m gives Australia, full Africa, and accurate coastlines.
  const MASK_W = 2048;
  const MASK_H = 1024;
  const mask = await buildLandMask(MASK_W, MASK_H);

  const w = container.clientWidth;
  const h = container.clientHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  camera.position.set(0, 0, 5.4);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  // ---- Opaque dark inner sphere (depth occlusion for back-side dots) ----
  // Slightly smaller than the dot radius so dots sit just on the surface,
  // and fully opaque so the depth test reliably culls the back hemisphere.
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(1.595, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x0c0a24 })
  );

  // ---- Fibonacci-distributed dots, masked by land ----
  const RADIUS = 1.6;
  const COUNT = 32000;
  const positions = [];
  const sizes = [];

  for (let i = 0; i < COUNT; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / COUNT);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;

    const lat = 90 - (phi * 180 / Math.PI);
    let lon = (theta * 180 / Math.PI) % 360;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;

    if (!sampleLand(mask, lon, lat)) continue;

    // Standard (lat, lon) → (x, y, z) with +Y as the polar axis
    // and longitude 0° at +Z (facing the camera).
    const latR = lat * Math.PI / 180;
    const lonR = lon * Math.PI / 180;
    const cosLat = Math.cos(latR);
    positions.push(
      cosLat * Math.sin(lonR) * RADIUS,
      Math.sin(latR) * RADIUS,
      cosLat * Math.cos(lonR) * RADIUS
    );
    sizes.push(0.05 + Math.random() * 0.02);
  }

  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  dotGeo.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));

  const dotMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xffffff) },
    },
    vertexShader: `
      attribute float size;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (340.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    // Uniform white dots, no depth-based dimming or colour shift.
    // The opaque inner sphere occludes far-hemisphere dots via the depth
    // test so the front always reads cleanly without manual fading.
    fragmentShader: `
      uniform vec3 uColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float fade = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor, fade);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const dots = new THREE.Points(dotGeo, dotMat);

  // No axial tilt, no initial rotation — model defaults.
  const spinGroup = new THREE.Group();
  spinGroup.add(core, rim, dots);
  scene.add(spinGroup);

  // ---- Animate ----
  let raf = null;
  const clock = new THREE.Clock();
  function animate() {
    spinGroup.rotation.y += clock.getDelta() * 0.30;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(animate);
  }
  animate();

  // ---- Resize ----
  const ro = new ResizeObserver(() => {
    const ww = container.clientWidth;
    const hh = container.clientHeight;
    if (ww > 0 && hh > 0) {
      camera.aspect = ww / hh;
      camera.updateProjectionMatrix();
      renderer.setSize(ww, hh);
    }
  });
  ro.observe(container);

  // ---- Pause when off-screen ----
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && raf === null) {
        animate();
      } else if (!e.isIntersecting && raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }
  });
  io.observe(container);
}

/* Land-mask: rasterise the world-atlas land topojson to an equirectangular
 * canvas at MASK_W × MASK_H, return the raw RGBA buffer for fast sampling. */
async function buildLandMask(W, H) {
  const url = "https://unpkg.com/world-atlas@2.0.2/land-50m.json";
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

  const project = (lon, lat) => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];

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

  const drawGeom = (g) => {
    if (g.type === "Polygon") {
      for (const r of g.coordinates) drawRing(r);
    } else if (g.type === "MultiPolygon") {
      for (const p of g.coordinates) for (const r of p) drawRing(r);
    }
  };

  if (land.type === "FeatureCollection") {
    for (const f of land.features) drawGeom(f.geometry);
  } else if (land.type === "Feature") {
    drawGeom(land.geometry);
  } else {
    drawGeom(land);
  }

  return { width: W, height: H, data: ctx.getImageData(0, 0, W, H).data };
}

function sampleLand(mask, lon, lat) {
  const x = Math.floor(((lon + 180) / 360) * mask.width) % mask.width;
  const y = Math.max(0, Math.min(mask.height - 1, Math.floor(((90 - lat) / 180) * mask.height)));
  return mask.data[(y * mask.width + x) * 4] > 128;
}
