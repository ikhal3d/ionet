/* Spinning dotted earth using globe.gl.
 * Renders each country as a mosaic of small hex-polygon dots so the
 * continents are clearly recognisable. Globe.gl handles the projection,
 * camera, and rotation correctly — we just feed it country features. */

import Globe from "https://esm.sh/globe.gl@2.32";
import * as topojson from "https://esm.sh/topojson-client@3.1.0";

const stage = document.getElementById("earth");
if (stage && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  initEarth(stage).catch((err) => console.error("[earth] init failed:", err));
}

async function initEarth(container) {
  // Country boundary data — Natural Earth via the world-atlas npm package.
  //   countries-110m.json (~110 KB, coarse, drops small countries)
  //   countries-50m.json  (~756 KB, sweet spot — keeps Australia, full Africa)
  //   For full 10m detail, fetch directly from naturalearthdata.com
  const DATA_URL = "https://unpkg.com/world-atlas@2.0.2/countries-50m.json";

  const resp = await fetch(DATA_URL);
  if (!resp.ok) throw new Error(`world-atlas fetch failed: ${resp.status}`);
  const topo = await resp.json();
  const features = topojson.feature(topo, topo.objects.countries).features;

  const globe = Globe()
    (container)
    .backgroundColor("rgba(0,0,0,0)")
    .showAtmosphere(true)
    .atmosphereColor("#6a2dc7")
    .atmosphereAltitude(0.18)
    .hexPolygonsData(features)
    // Resolution 4 = ~85k hex cells globally (vs ~12k at res 3).
    // Required for small countries to have any dots at all.
    .hexPolygonResolution(4)
    .hexPolygonMargin(0.3)
    .hexPolygonColor(() => "#ffffff");

  // Make the underlying sphere a deep transparent ink so dots stand out
  const mat = globe.globeMaterial();
  if (mat) {
    mat.color.set(0x15123a);
    mat.opacity = 0.85;
    mat.transparent = true;
  }

  // Start with Australia front-and-centre
  globe.pointOfView({ lat: -25, lng: 134, altitude: 2.4 }, 0);

  // Auto-rotate; disable user pan/zoom so it stays a passive visual
  const controls = globe.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.6;
  controls.enableZoom = false;
  controls.enablePan = false;

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

  // Pause auto-rotation when off-screen
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) controls.autoRotate = e.isIntersecting;
  });
  io.observe(container);
}
