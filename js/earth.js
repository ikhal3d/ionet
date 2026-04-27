/* Spinning dotted earth — pure WebGL via three.js (CDN ESM)
 * Renders a sphere of points sampled on a Fibonacci lattice, then masks
 * dots so only land outlines (sampled from an equirectangular map) glow.
 * Cybersecurity vibe: tight orange/gold dots over a deep purple core. */

import * as THREE from "https://esm.sh/three@0.160.0";

const stage = document.getElementById("earth");
if (stage && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  initEarth(stage);
}

function initEarth(container) {
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

  // ----- Globe core (subtle, near-invisible sphere for depth occlusion) -----
  const coreGeo = new THREE.SphereGeometry(1.6, 64, 64);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0x150330,
    transparent: true,
    opacity: 0.55,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  scene.add(core);

  // Subtle rim glow
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
        gl_FragColor = vec4(0.88, 0.6, 0.0, 1.0) * intensity;
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  scene.add(rim);

  // ----- Fibonacci sphere of dots, masked by procedural continents -----
  const RADIUS = 1.6;
  const COUNT = 6500;
  const positions = [];
  const sizes = [];

  for (let i = 0; i < COUNT; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / COUNT);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;

    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.sin(phi) * Math.sin(theta);
    const z = Math.cos(phi);

    // Lat / lon for procedural continent mask
    const lat = (Math.PI / 2 - phi) * (180 / Math.PI);
    const lon = (theta % (2 * Math.PI)) * (180 / Math.PI) - 180;

    if (isLand(lat, lon)) {
      positions.push(x * RADIUS, y * RADIUS, z * RADIUS);
      sizes.push(0.04 + Math.random() * 0.02);
    }
  }

  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  dotGeo.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));

  const dotMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xffb833) },
      uColor2: { value: new THREE.Color(0xe09900) },
    },
    vertexShader: `
      attribute float size;
      varying float vDepth;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mvPosition.z;
        gl_PointSize = size * (300.0 / -mvPosition.z);
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
        // Far dots dimmer (back of globe)
        float depthFade = smoothstep(8.0, 4.0, vDepth);
        vec3 col = mix(uColor2, uColor, depthFade);
        gl_FragColor = vec4(col, fade * (0.35 + 0.65 * depthFade));
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const dots = new THREE.Points(dotGeo, dotMat);
  scene.add(dots);

  // ----- Orbit ring (decorative) -----
  const ringGeo = new THREE.RingGeometry(2.4, 2.42, 128);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xe09900,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.25,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2.6;
  scene.add(ring);

  // ----- Animate -----
  const group = new THREE.Group();
  group.add(core, rim, dots);
  scene.add(group);

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

  // ----- Resize -----
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ro.observe(container);

  // Pause when hidden
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

/* Procedural continent mask — analytic blob field tuned to roughly approximate
 * landmass shapes. Not cartographically accurate, but produces a recognizable
 * dotted-earth silhouette without bundling a texture. */
function isLand(lat, lon) {
  // Each blob: [centerLat, centerLon, radiusLat, radiusLon, threshold]
  const blobs = [
    // North America
    [54, -100, 22, 30, 1], [40, -100, 14, 26, 1], [25, -100, 8, 14, 1],
    [60, -150, 14, 22, 1], [70, -90, 10, 30, 1],
    // South America
    [-10, -60, 18, 14, 1], [-30, -65, 14, 10, 1], [-45, -70, 10, 6, 1],
    // Europe
    [50, 15, 12, 20, 1], [60, 25, 8, 30, 1], [40, 15, 6, 14, 1],
    // Africa
    [10, 20, 18, 18, 1], [-10, 25, 14, 14, 1], [-25, 25, 10, 12, 1],
    // Asia
    [55, 90, 18, 50, 1], [40, 90, 14, 40, 1], [30, 100, 10, 25, 1],
    [20, 80, 12, 14, 1], [25, 110, 8, 18, 1],
    // Southeast Asia / Indonesia
    [0, 115, 6, 20, 1],
    // Australia
    [-25, 135, 10, 18, 1],
    // Greenland
    [72, -40, 10, 14, 1],
    // Antarctica band
    [-80, 0, 8, 180, 1],
  ];

  let v = 0;
  for (const [clat, clon, rlat, rlon] of blobs) {
    let dlon = lon - clon;
    if (dlon > 180) dlon -= 360;
    if (dlon < -180) dlon += 360;
    const dx = dlon / rlon;
    const dy = (lat - clat) / rlat;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1) v += 1 - d2;
  }
  // Random sparseness so it looks like dotted continents, not solid mass
  return v > 0.15 && Math.random() < 0.65;
}
