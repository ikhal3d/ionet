/* Spinning dotted earth using globe.gl — a battle-tested three.js wrapper
 * that handles country boundaries, projection, and rotation correctly.
 *
 * Each country is rendered as a hex-polygon mosaic of dots; the globe
 * auto-rotates and is fully transparent so the page background shows
 * through. Pauses when off-screen to save battery. */

import Globe from "https://esm.sh/globe.gl@2.36";
import * as topojson from "https://esm.sh/topojson-client@3.1.0";

const stage = document.getElementById("earth");
if (stage && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  initEarth(stage).catch((err) => console.error("[earth] init failed:", err));
}

async function initEarth(container) {
  // Fetch country boundaries (Natural Earth 110m via world-atlas)
  const url = "https://esm.sh/world-atlas@2.0.2/countries-110m.json";
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`world-atlas fetch failed: ${resp.status}`);
  const topo = await resp.json();
  const countries = topojson.feature(topo, topo.objects.countries);

  const globe = new Globe(container, { animateIn: false })
    .backgroundColor("rgba(0,0,0,0)")
    .showGlobe(true)
    .showAtmosphere(true)
    .atmosphereColor("#6a2dc7")
    .atmosphereAltitude(0.18)
    .globeImageUrl(null)
    .hexPolygonsData(countries.features)
    .hexPolygonResolution(3)
    .hexPolygonMargin(0.35)
    .hexPolygonUseDots(true)
    .hexPolygonColor(() => "#ffffff");

  // Solid dark sphere underneath the dots so they read against deep ink
  const scene = globe.scene();
  const renderer = globe.renderer();
  if (renderer) renderer.setClearColor(0x000000, 0);

  // Style the underlying globe mesh: transparent dark base
  const mat = globe.globeMaterial();
  if (mat) {
    mat.color.set(0x15123a);
    mat.transparent = true;
    mat.opacity = 0.9;
  }

  // Auto-rotation
  const controls = globe.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.enableZoom = false;
  controls.enablePan = false;

  // Initial point-of-view: Australia (lat -25, lon 134)
  globe.pointOfView({ lat: -22, lng: 134, altitude: 2.4 }, 0);

  // Resize handling
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) {
      globe.width(w);
      globe.height(h);
    }
  });
  ro.observe(container);

  // Pause when off-screen
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      controls.autoRotate = e.isIntersecting;
    }
  });
  io.observe(container);
}
