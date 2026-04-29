/* ionet — Internet Exchange Points dataset.
   Curated list of major IXPs by traffic / member count + complete Australian set.
   Source: PCH IXP database, IX Australia, operator websites.
   tier: 1 = always labelled · 2 = small dot, label on hover · au = full AU set */

window.IONET_IXPS = [
  // ─── Tier 1 — global hubs (always labelled) ─────────────────────────
  { name: "LINX London",         lat: 51.51, lon:  -0.13, tier: 1 },
  { name: "AMS-IX Amsterdam",    lat: 52.35, lon:   4.94, tier: 1 },
  { name: "DE-CIX Frankfurt",    lat: 50.11, lon:   8.68, tier: 1 },
  { name: "France-IX Paris",     lat: 48.86, lon:   2.35, tier: 1 },
  { name: "Equinix Ashburn",     lat: 39.04, lon: -77.49, tier: 1 },
  { name: "NYIIX New York",      lat: 40.71, lon: -74.00, tier: 1 },
  { name: "Equinix Los Angeles", lat: 34.05, lon:-118.24, tier: 1 },
  { name: "TorIX Toronto",       lat: 43.65, lon: -79.38, tier: 1 },
  { name: "IX.br São Paulo",     lat:-23.55, lon: -46.64, tier: 1 },
  { name: "HKIX Hong Kong",      lat: 22.30, lon: 114.17, tier: 1 },
  { name: "JPNAP Tokyo",         lat: 35.69, lon: 139.69, tier: 1 },
  { name: "Equinix Singapore",   lat:  1.29, lon: 103.85, tier: 1 },
  { name: "NIXI Mumbai",         lat: 19.08, lon:  72.88, tier: 1 },
  { name: "NAPAfrica J'burg",    lat:-26.20, lon:  28.04, tier: 1 },
  { name: "Sydney IX",           lat:-33.87, lon: 151.21, tier: 1 },

  // ─── Tier 2 — significant secondary hubs (hover label) ──────────────
  { name: "MSK-IX Moscow",       lat: 55.75, lon:  37.62, tier: 2 },
  { name: "VIX Vienna",          lat: 48.21, lon:  16.37, tier: 2 },
  { name: "NIX.CZ Prague",       lat: 50.08, lon:  14.44, tier: 2 },
  { name: "ESPANIX Madrid",      lat: 40.42, lon:  -3.70, tier: 2 },
  { name: "INEX Dublin",         lat: 53.35, lon:  -6.26, tier: 2 },
  { name: "NL-ix",               lat: 52.08, lon:   4.31, tier: 2 },
  { name: "MIX Milan",           lat: 45.46, lon:   9.19, tier: 2 },
  { name: "DE-CIX Chennai",      lat: 13.08, lon:  80.27, tier: 2 },
  { name: "BBIX Tokyo",          lat: 35.66, lon: 139.74, tier: 2 },
  { name: "KINX Seoul",          lat: 37.57, lon: 126.98, tier: 2 },
  { name: "BKNIX Bangkok",       lat: 13.75, lon: 100.50, tier: 2 },
  { name: "JKT-IX Jakarta",      lat: -6.21, lon: 106.85, tier: 2 },
  { name: "KIXP Nairobi",        lat: -1.29, lon:  36.82, tier: 2 },
  { name: "IXPN Lagos",          lat:  6.45, lon:   3.40, tier: 2 },
  { name: "CABASE Buenos Aires", lat:-34.60, lon: -58.45, tier: 2 },
  { name: "Equinix Mexico City", lat: 19.43, lon: -99.13, tier: 2 },
  { name: "Equinix Seattle",     lat: 47.61, lon:-122.33, tier: 2 },
  { name: "Equinix Chicago",     lat: 41.88, lon: -87.63, tier: 2 },
  { name: "Equinix Miami",       lat: 25.76, lon: -80.19, tier: 2 },
  { name: "Equinix Dallas",      lat: 32.78, lon: -96.80, tier: 2 },
  { name: "DE-CIX Dubai",        lat: 25.20, lon:  55.27, tier: 2 },
  { name: "NAPAfrica Cape Town", lat:-33.92, lon:  18.42, tier: 2 },
  { name: "Equinix Auckland",    lat:-36.85, lon: 174.76, tier: 2 },

  // ─── Australia — complete major-IXP set (also rendered in AU panel) ─
  { name: "MIX Melbourne",       lat:-37.81, lon: 144.96, tier: "au" },
  { name: "BIX Brisbane",        lat:-27.47, lon: 153.03, tier: "au" },
  { name: "PIX Perth",           lat:-31.95, lon: 115.86, tier: "au" },
  { name: "ADIX Adelaide",       lat:-34.93, lon: 138.60, tier: "au" },
  { name: "CBR-IX Canberra",     lat:-35.28, lon: 149.13, tier: "au" },
  { name: "HOX Hobart",          lat:-42.88, lon: 147.32, tier: "au" }
];
