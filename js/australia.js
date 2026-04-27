/* Dotted Australia map — fetches countries-110m topojson, isolates Australia,
 * rasterizes the polygon to a hidden canvas, and emits a grid of white dots
 * wherever the canvas pixel is "land". Renders into <div id="australia">. */

import * as topojson from "https://esm.sh/topojson-client@3.1.0";

const stage = document.getElementById("australia");
if (stage) {
  buildDottedAustralia(stage).catch((err) =>
    console.error("[australia] init failed:", err)
  );
}

async function buildDottedAustralia(container) {
  const url = "https://esm.sh/world-atlas@2.0.2/countries-110m.json";
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
  const topo = await resp.json();
  const fc = topojson.feature(topo, topo.objects.countries);

  // Australia ISO numeric is "036" (id field varies — sometimes string, sometimes number)
  const aus = fc.features.find((f) => {
    const id = String(f.id);
    return id === "36" || id === "036" || (f.properties && f.properties.name === "Australia");
  });
  if (!aus) throw new Error("Australia geometry not found");

  // Compute bounding box for the projection
  const bbox = computeBBox(aus.geometry);
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;

  // Render polygon to a hidden canvas at fixed resolution
  const W = 400;
  const H = Math.round(W * (latSpan / lonSpan));
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff";

  const project = (lon, lat) => [
    ((lon - minLon) / lonSpan) * W,
    ((maxLat - lat) / latSpan) * H,
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

  const drawGeometry = (g) => {
    if (g.type === "Polygon") {
      for (const ring of g.coordinates) drawRing(ring);
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) {
        for (const ring of poly) drawRing(ring);
      }
    }
  };
  drawGeometry(aus.geometry);

  // Sample on a grid; emit a dot for each filled pixel
  const data = ctx.getImageData(0, 0, W, H).data;
  const step = 7;
  const dotR = 1.6;
  const dots = [];
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const idx = (y * W + x) * 4;
      if (data[idx] > 128) dots.push([x, y]);
    }
  }

  // Build the SVG output
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";

  // Subtle glow behind
  const glow = document.createElementNS(svgNS, "defs");
  glow.innerHTML = `
    <radialGradient id="ausGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#6a2dc7" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#6a2dc7" stop-opacity="0"/>
    </radialGradient>
    <filter id="ausBlur"><feGaussianBlur stdDeviation="1.4"/></filter>
  `;
  svg.appendChild(glow);

  const bg = document.createElementNS(svgNS, "ellipse");
  bg.setAttribute("cx", W / 2);
  bg.setAttribute("cy", H / 2);
  bg.setAttribute("rx", W * 0.55);
  bg.setAttribute("ry", H * 0.55);
  bg.setAttribute("fill", "url(#ausGlow)");
  svg.appendChild(bg);

  // Dot group
  const g = document.createElementNS(svgNS, "g");
  g.setAttribute("fill", "#FFFFFF");
  for (const [x, y] of dots) {
    const c = document.createElementNS(svgNS, "circle");
    c.setAttribute("cx", x);
    c.setAttribute("cy", y);
    c.setAttribute("r", dotR);
    g.appendChild(c);
  }
  svg.appendChild(g);

  // Highlight pin for Melbourne (~144.96°E, -37.81°S)
  const [mx, my] = project(144.96, -37.81);
  const pinGlow = document.createElementNS(svgNS, "circle");
  pinGlow.setAttribute("cx", mx);
  pinGlow.setAttribute("cy", my);
  pinGlow.setAttribute("r", 7);
  pinGlow.setAttribute("fill", "#CC00FF");
  pinGlow.setAttribute("opacity", "0.5");
  pinGlow.setAttribute("filter", "url(#ausBlur)");
  svg.appendChild(pinGlow);

  const pin = document.createElementNS(svgNS, "circle");
  pin.setAttribute("cx", mx);
  pin.setAttribute("cy", my);
  pin.setAttribute("r", 3.5);
  pin.setAttribute("fill", "#FFB833");
  svg.appendChild(pin);

  const ring = document.createElementNS(svgNS, "circle");
  ring.setAttribute("cx", mx);
  ring.setAttribute("cy", my);
  ring.setAttribute("r", 5);
  ring.setAttribute("fill", "none");
  ring.setAttribute("stroke", "#FFB833");
  ring.setAttribute("stroke-width", "1");
  ring.setAttribute("opacity", "0.7");
  svg.appendChild(ring);

  container.replaceChildren(svg);
}

function computeBBox(geom) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const visit = (ring) => {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  };
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) visit(ring);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) for (const ring of poly) visit(ring);
  }
  // Trim Heard Island and other tiny far-flung territories to keep the
  // visual focused on the mainland; clamp lat to keep mainland-only.
  if (minLat < -45) minLat = -45;
  if (maxLat > -8) maxLat = -8;
  if (minLon < 110) minLon = 110;
  if (maxLon > 158) maxLon = 158;
  return [minLon, minLat, maxLon, maxLat];
}
