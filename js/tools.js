/* ionet tools — client-side utilities + Phase 2 server-side tool clients.
   Browser tools never leave the device.
   Server tools call /api/* through the Cloudflare Worker → Oracle VM. */
(function () {
  "use strict";

  // ---- Helpers --------------------------------------------------------------
  const $  = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // Backend API base. Empty string = same-origin (`/api/*` → Cloudflare Worker
  // → Oracle VM). Override via `localStorage.IONET_API_BASE = "https://...";`
  // for ad-hoc testing against a Cloudflare quick-tunnel URL.
  const API_BASE = (function () {
    try {
      const ls = localStorage.getItem("IONET_API_BASE");
      if (ls) return ls.replace(/\/+$/, "");
    } catch (_) { /* ignore */ }
    return window.IONET_API_BASE || "";
  })();
  function apiUrl(path) { return API_BASE + path; }
  async function apiPost(path, body) {
    const r = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(body || {}),
    });
    let data; try { data = await r.json(); } catch (_) { data = null; }
    return { ok: r.ok, status: r.status, data };
  }
  async function apiGet(path) {
    const r = await fetch(apiUrl(path), { credentials: "omit" });
    let data; try { data = await r.json(); } catch (_) { data = null; }
    return { ok: r.ok, status: r.status, data };
  }
  function networkError(out, err) {
    setOut(out,
      "Couldn't reach the ionet backend. The Phase 2 backend may not be deployed yet — see <a href=\"https://github.com/ikhal3d/ionet/blob/main/backend/DEPLOY.md\" rel=\"noopener\">backend/DEPLOY.md</a>." +
      (err && err.message ? `<div style=\"margin-top:8px;color:var(--text-dim);font-size:0.85rem;\">Detail: ${escapeHTML(err.message)}</div>` : ""),
      true
    );
  }

  function setOut(el, html, isError) {
    if (!el) return;
    el.classList.toggle("error", !!isError);
    el.innerHTML = html;
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function copyButton(text) {
    const safe = escapeHTML(text).replace(/`/g, "&#96;");
    return `<button class="copy-btn" type="button" data-copy="${safe}">Copy</button>`;
  }
  function bytesToHex(buf) {
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  function tableRows(pairs) {
    return pairs.map(([k, v]) =>
      `<tr><th>${escapeHTML(k)}</th><td><code>${escapeHTML(v)}</code></td></tr>`
    ).join("");
  }

  // Global click handler for any copy button
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".copy-btn");
    if (!btn) return;
    const text = btn.getAttribute("data-copy") || "";
    const tmp = document.createElement("textarea");
    tmp.textContent = text;
    document.body.appendChild(tmp);
    tmp.select();
    try { document.execCommand("copy"); } catch (_) { /* ignore */ }
    document.body.removeChild(tmp);
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    btn.classList.add("copied");
    btn.textContent = "Copied";
    setTimeout(() => { btn.classList.remove("copied"); btn.textContent = "Copy"; }, 1400);
  });

  // ---- IPv4 helpers ---------------------------------------------------------
  function parseIPv4(str) {
    const parts = String(str).trim().split(".");
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
      if (!/^\d+$/.test(p)) return null;
      const v = parseInt(p, 10);
      if (v < 0 || v > 255) return null;
      n = (n * 256) + v;
    }
    return n >>> 0;
  }
  function ipFromInt(n) {
    n = n >>> 0;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
  }
  function maskFromPrefix(p) {
    return p === 0 ? 0 : ((0xffffffff << (32 - p)) >>> 0);
  }
  function parseCIDR(str) {
    const m = String(str).trim().match(/^(\d+\.\d+\.\d+\.\d+)\s*\/\s*(\d+)$/);
    if (!m) return null;
    const ip = parseIPv4(m[1]);
    const prefix = parseInt(m[2], 10);
    if (ip === null || prefix < 0 || prefix > 32) return null;
    return { ip, prefix };
  }

  // ---- Subnet / CIDR Calculator --------------------------------------------
  (function subnetCalc() {
    const input = $("sn-input"), btn = $("sn-go"), out = $("sn-out");
    if (!input || !btn || !out) return;
    function go() {
      const parsed = parseCIDR(input.value);
      if (!parsed) {
        setOut(out, "Couldn't parse that. Try <code>10.0.5.0/24</code>.", true);
        return;
      }
      const { ip, prefix } = parsed;
      const mask = maskFromPrefix(prefix);
      const network = (ip & mask) >>> 0;
      const broadcast = (network | (~mask >>> 0)) >>> 0;
      const total = prefix === 32 ? 1 : (prefix === 31 ? 2 : (broadcast - network + 1));
      const usable = prefix >= 31 ? total : (total - 2);
      const first = prefix >= 31 ? network : (network + 1) >>> 0;
      const last  = prefix >= 31 ? broadcast : (broadcast - 1) >>> 0;
      const wildcard = (~mask) >>> 0;
      const hostBits = 32 - prefix;
      const ipClass =
        ((ip >>> 24) < 128) ? "A" :
        ((ip >>> 24) < 192) ? "B" :
        ((ip >>> 24) < 224) ? "C" :
        ((ip >>> 24) < 240) ? "D (multicast)" : "E (reserved)";
      const isPrivate =
        ((ip >>> 24) === 10) ||
        (((ip >>> 24) === 172) && (((ip >>> 16) & 0xff) >= 16) && (((ip >>> 16) & 0xff) <= 31)) ||
        (((ip >>> 24) === 192) && (((ip >>> 16) & 0xff) === 168));
      setOut(out, `<table>${tableRows([
        ["Input",            `${ipFromInt(ip)}/${prefix}`],
        ["Network address",  `${ipFromInt(network)}`],
        ["Broadcast",        `${ipFromInt(broadcast)}`],
        ["First usable",     `${ipFromInt(first)}`],
        ["Last usable",      `${ipFromInt(last)}`],
        ["Subnet mask",      `${ipFromInt(mask)}`],
        ["Wildcard mask",    `${ipFromInt(wildcard)}`],
        ["Total addresses",  `${total.toLocaleString()}`],
        ["Usable hosts",     `${usable.toLocaleString()}`],
        ["Host bits",        `${hostBits}`],
        ["IP class",         ipClass],
        ["RFC1918 private",  isPrivate ? "yes" : "no"],
      ])}</table>`);
    }
    btn.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    go();
  })();

  // ---- VLSM Planner ---------------------------------------------------------
  (function vlsm() {
    const base = $("vl-base"), needs = $("vl-needs"), btn = $("vl-go"), out = $("vl-out");
    if (!base || !needs || !btn || !out) return;
    function prefixForHosts(h) {
      if (h <= 0) return null;
      const required = h + 2; // network + broadcast
      let bits = 0;
      while ((1 << bits) < required) bits++;
      const prefix = 32 - bits;
      if (prefix < 0) return null;
      return prefix;
    }
    function go() {
      const parsed = parseCIDR(base.value);
      if (!parsed) { setOut(out, "Parent prefix must be CIDR like <code>10.0.0.0/16</code>.", true); return; }
      const { ip: baseIp, prefix: parentPrefix } = parsed;
      const network = (baseIp & maskFromPrefix(parentPrefix)) >>> 0;
      const total = parentPrefix === 32 ? 1 : Math.pow(2, 32 - parentPrefix);
      const limit = (network + total - 1) >>> 0;

      const hostList = needs.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      const items = hostList.map((s, i) => ({
        idx: i, raw: s, hosts: parseInt(s, 10),
      })).filter((x) => Number.isFinite(x.hosts) && x.hosts > 0);
      if (items.length === 0) { setOut(out, "Enter one or more host counts (e.g. <code>500, 100, 50</code>).", true); return; }

      // Allocate largest first to minimise waste
      items.sort((a, b) => b.hosts - a.hosts);

      let cursor = network;
      const results = [];
      for (const it of items) {
        const p = prefixForHosts(it.hosts);
        if (p === null) { results.push({ ...it, error: "host count out of range" }); continue; }
        const blockSize = Math.pow(2, 32 - p);
        // Align cursor to blockSize
        const aligned = (Math.ceil(cursor / blockSize) * blockSize) >>> 0;
        if (aligned + blockSize - 1 > limit) {
          results.push({ ...it, error: `doesn't fit in /${parentPrefix}` });
          continue;
        }
        const net = aligned >>> 0;
        const bcast = (net + blockSize - 1) >>> 0;
        results.push({
          ...it,
          prefix: p,
          network: ipFromInt(net),
          broadcast: ipFromInt(bcast),
          first: p >= 31 ? ipFromInt(net) : ipFromInt((net + 1) >>> 0),
          last:  p >= 31 ? ipFromInt(bcast) : ipFromInt((bcast - 1) >>> 0),
          usable: p >= 31 ? (p === 31 ? 2 : 1) : (blockSize - 2),
        });
        cursor = (aligned + blockSize) >>> 0;
      }
      // Restore original input order for display
      results.sort((a, b) => a.idx - b.idx);
      let html = `<div style="margin-bottom:10px;color:var(--text-muted);">Parent: <code>${ipFromInt(network)}/${parentPrefix}</code> &middot; allocated largest-first, displayed in input order.</div>`;
      html += "<table><tr><th>Need</th><th>Prefix</th><th>Network</th><th>Range</th><th>Broadcast</th><th>Usable</th></tr>";
      for (const r of results) {
        if (r.error) {
          html += `<tr><td><code>${r.hosts}</code></td><td colspan="5" style="color:#ffb1bf;">${escapeHTML(r.error)}</code></td></tr>`;
        } else {
          html += `<tr><td><code>${r.hosts}</code></td><td><code>/${r.prefix}</code></td><td><code>${r.network}</code></td><td><code>${r.first} – ${r.last}</code></td><td><code>${r.broadcast}</code></td><td><code>${r.usable.toLocaleString()}</code></td></tr>`;
        }
      }
      html += "</table>";
      setOut(out, html);
    }
    btn.addEventListener("click", go);
    go();
  })();

  // ---- JWT Decoder ----------------------------------------------------------
  (function jwt() {
    const input = $("jw-input"), btn = $("jw-go"), out = $("jw-out");
    if (!input || !btn || !out) return;
    function b64urlDecode(s) {
      s = s.replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4) s += "=";
      const bin = atob(s);
      // Decode as UTF-8
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return dec.decode(arr);
    }
    function go() {
      const raw = input.value.trim();
      const parts = raw.split(".");
      if (parts.length !== 3) { setOut(out, "JWT must have three segments separated by dots.", true); return; }
      try {
        const header  = JSON.parse(b64urlDecode(parts[0]));
        const payload = JSON.parse(b64urlDecode(parts[1]));
        const sigLen  = parts[2].length;
        let extras = "";
        if (typeof payload.exp === "number") {
          const exp = new Date(payload.exp * 1000);
          const now = Date.now();
          const diff = (payload.exp * 1000) - now;
          const status = diff < 0 ? `<span style="color:#ffb1bf;">expired ${Math.round(-diff/60000)} min ago</span>` :
                                     `expires in ${Math.round(diff/60000)} min`;
          extras += `<div style="margin-top:6px;color:var(--text-muted);"><strong>exp</strong> &rarr; ${exp.toISOString()} &middot; ${status}</div>`;
        }
        if (typeof payload.iat === "number") {
          extras += `<div style="color:var(--text-muted);"><strong>iat</strong> &rarr; ${new Date(payload.iat*1000).toISOString()}</div>`;
        }
        if (typeof payload.nbf === "number") {
          extras += `<div style="color:var(--text-muted);"><strong>nbf</strong> &rarr; ${new Date(payload.nbf*1000).toISOString()}</div>`;
        }
        const html =
          `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <div><div style="color:var(--text-muted);font-size:0.8rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">Header</div><pre style="margin:0;">${escapeHTML(JSON.stringify(header, null, 2))}</pre></div>
            <div><div style="color:var(--text-muted);font-size:0.8rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">Payload</div><pre style="margin:0;">${escapeHTML(JSON.stringify(payload, null, 2))}</pre></div>
          </div>
          ${extras}
          <div style="margin-top:10px;color:var(--text-muted);">Signature: ${sigLen} characters &middot; <em>not verified — requires the issuer's key</em>.</div>`;
        setOut(out, html);
      } catch (e) {
        setOut(out, "Couldn't decode — header or payload isn't valid Base64URL JSON.", true);
      }
    }
    btn.addEventListener("click", go);
    go();
  })();

  // ---- Hash Generator -------------------------------------------------------
  (function hash() {
    const input = $("ha-input"), algo = $("ha-algo"), btn = $("ha-go"), out = $("ha-out");
    if (!input || !algo || !btn || !out) return;
    async function go() {
      const data = enc.encode(input.value);
      try {
        const buf = await crypto.subtle.digest(algo.value, data);
        const hex = bytesToHex(buf);
        setOut(out, `${copyButton(hex)}<div style="color:var(--text-muted);font-size:0.8rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">${escapeHTML(algo.value)} &middot; ${hex.length * 4} bits</div>${escapeHTML(hex)}`);
      } catch (e) {
        setOut(out, "Hashing failed: " + escapeHTML(e.message || String(e)), true);
      }
    }
    btn.addEventListener("click", go);
  })();

  // ---- HMAC Generator -------------------------------------------------------
  (function hmac() {
    const key = $("hm-key"), msg = $("hm-msg"), btn = $("hm-go"), out = $("hm-out");
    if (!key || !msg || !btn || !out) return;
    async function go() {
      try {
        const cryptoKey = await crypto.subtle.importKey(
          "raw",
          enc.encode(key.value),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );
        const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg.value));
        const hex = bytesToHex(sig);
        const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
        setOut(out, `${copyButton(hex)}<div style="color:var(--text-muted);font-size:0.8rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">HMAC-SHA256 (hex)</div>${escapeHTML(hex)}<div style="margin-top:14px;color:var(--text-muted);font-size:0.8rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">Base64</div>${copyButton(b64)}${escapeHTML(b64)}`);
      } catch (e) {
        setOut(out, "HMAC failed: " + escapeHTML(e.message || String(e)), true);
      }
    }
    btn.addEventListener("click", go);
  })();

  // ---- Base64 ---------------------------------------------------------------
  (function b64() {
    const input = $("b64-input"), btnE = $("b64-encode"), btnD = $("b64-decode"), out = $("b64-out");
    if (!input || !btnE || !btnD || !out) return;
    btnE.addEventListener("click", () => {
      try {
        const b = btoa(String.fromCharCode(...enc.encode(input.value)));
        setOut(out, copyButton(b) + escapeHTML(b));
      } catch (e) {
        setOut(out, "Encode failed: " + escapeHTML(e.message), true);
      }
    });
    btnD.addEventListener("click", () => {
      try {
        const bin = atob(input.value.trim().replace(/\s+/g, ""));
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const text = dec.decode(arr);
        setOut(out, copyButton(text) + escapeHTML(text));
      } catch (e) {
        setOut(out, "Decode failed — input isn't valid Base64.", true);
      }
    });
  })();

  // ---- URL encode/decode ----------------------------------------------------
  (function urlcodec() {
    const input = $("ue-input"), btnE = $("ue-encode"), btnD = $("ue-decode"), out = $("ue-out");
    if (!input || !btnE || !btnD || !out) return;
    btnE.addEventListener("click", () => {
      const v = encodeURIComponent(input.value);
      setOut(out, copyButton(v) + escapeHTML(v));
    });
    btnD.addEventListener("click", () => {
      try {
        const v = decodeURIComponent(input.value);
        setOut(out, copyButton(v) + escapeHTML(v));
      } catch (e) {
        setOut(out, "Decode failed — malformed percent-encoding.", true);
      }
    });
  })();

  // ---- Password generator ---------------------------------------------------
  (function pwgen() {
    const len = $("pw-len"), low = $("pw-lower"), upp = $("pw-upper"),
          dig = $("pw-digit"), sym = $("pw-symb"), amb = $("pw-ambig"),
          btn = $("pw-go"), out = $("pw-out");
    if (!len || !btn || !out) return;
    const POOLS = {
      low: "abcdefghijklmnopqrstuvwxyz",
      upp: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      dig: "0123456789",
      sym: "!@#$%^&*()-_=+[]{};:,.<>/?~",
    };
    const AMBIG = /[Il1O0]/g;
    function go() {
      let pool = "";
      if (low.checked) pool += POOLS.low;
      if (upp.checked) pool += POOLS.upp;
      if (dig.checked) pool += POOLS.dig;
      if (sym.checked) pool += POOLS.sym;
      if (amb.checked) pool = pool.replace(AMBIG, "");
      if (!pool) { setOut(out, "Pick at least one character class.", true); return; }
      const n = Math.max(6, Math.min(128, parseInt(len.value, 10) || 20));
      const buf = new Uint32Array(n);
      crypto.getRandomValues(buf);
      let pw = "";
      for (let i = 0; i < n; i++) pw += pool[buf[i] % pool.length];
      // Crude entropy estimate
      const entropy = Math.round(n * Math.log2(pool.length));
      setOut(out, `${copyButton(pw)}<div style="color:var(--text-muted);font-size:0.8rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">${n} chars &middot; pool ${pool.length} &middot; ~${entropy} bits of entropy</div>${escapeHTML(pw)}`);
    }
    btn.addEventListener("click", go);
    go();
  })();

  // ---- UUID v4 --------------------------------------------------------------
  (function uuid() {
    const cnt = $("uu-count"), btn = $("uu-go"), out = $("uu-out");
    if (!cnt || !btn || !out) return;
    function v4() {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      a[6] = (a[6] & 0x0f) | 0x40; // version 4
      a[8] = (a[8] & 0x3f) | 0x80; // variant 10
      const hex = Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    }
    function go() {
      const n = Math.max(1, Math.min(100, parseInt(cnt.value, 10) || 5));
      const ids = Array.from({ length: n }, v4);
      const all = ids.join("\n");
      setOut(out, copyButton(all) + escapeHTML(all));
    }
    btn.addEventListener("click", go);
    go();
  })();

  // ---- IP converter ---------------------------------------------------------
  (function ipconv() {
    const input = $("ip-input"), btn = $("ip-go"), out = $("ip-out");
    if (!input || !btn || !out) return;
    function go() {
      const v = input.value.trim().replace(/\s+/g, "");
      let n = null;
      if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) {
        n = parseIPv4(v);
      } else if (/^0x[0-9a-f]+$/i.test(v)) {
        n = parseInt(v, 16);
      } else if (/^[01]{32}$/.test(v)) {
        n = parseInt(v, 2);
      } else if (/^\d+$/.test(v)) {
        n = parseInt(v, 10);
      }
      if (n === null || !Number.isFinite(n) || n < 0 || n > 0xffffffff) {
        setOut(out, "Couldn't recognise that as IPv4. Try <code>192.168.1.1</code>, <code>3232235777</code>, <code>0xC0A80101</code>, or 32 bits.", true);
        return;
      }
      n = n >>> 0;
      const dotted = ipFromInt(n);
      const dec    = n.toString(10);
      const hex    = "0x" + n.toString(16).toUpperCase().padStart(8, "0");
      const bin    = n.toString(2).padStart(32, "0").replace(/(.{8})(?!$)/g, "$1 ");
      setOut(out, `<table>${tableRows([
        ["Dotted-quad", dotted],
        ["Decimal",     dec],
        ["Hexadecimal", hex],
        ["Binary",      bin],
      ])}</table>`);
    }
    btn.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    go();
  })();

  // ---- What is my IP --------------------------------------------------------
  // Calls a public CORS-enabled service to discover the client's apparent
  // public IP. Primary: ipapi.co (returns IP + city/region/country/org).
  // Fallback: ipify.org (just the IP). User input/data is the request itself
  // — no input fields to send.
  (function whatIsMyIp() {
    const btn = $("wmi-go"), out = $("wmi-out");
    if (!btn || !out) return;
    async function go() {
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);font-size:0.92rem;">Asking ipapi.co…</div>`);
      try {
        const r = await fetch("https://ipapi.co/json/", { credentials: "omit" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        if (d.error) throw new Error(d.reason || "ipapi error");
        const rows = [
          ["IP address",  `<code>${escapeHTML(d.ip || "")}</code> ${copyButton(d.ip || "")}`],
          ["Reverse DNS", d.hostname ? `<code>${escapeHTML(d.hostname)}</code>` : "—"],
          ["City",        escapeHTML(d.city || "—") + (d.region ? `, ${escapeHTML(d.region)}` : "")],
          ["Country",     `${escapeHTML(d.country_name || "")} (<code>${escapeHTML(d.country_code || "")}</code>)`],
          ["Timezone",    escapeHTML(d.timezone || "—") + (d.utc_offset ? ` (UTC${escapeHTML(d.utc_offset)})` : "")],
          ["Organisation (ASN)", escapeHTML(d.org || d.asn || "—")],
          ["Network",     d.network ? `<code>${escapeHTML(d.network)}</code>` : "—"],
        ];
        const html = "<table>" + rows.map(([k, v]) => `<tr><th>${escapeHTML(k)}</th><td>${v}</td></tr>`).join("") + "</table>" +
          `<div style="margin-top:12px;color:var(--text-dim);font-size:0.85rem;">Data source: <a href="https://ipapi.co/" rel="noopener">ipapi.co</a> (free public API, rate-limited).</div>`;
        setOut(out, html);
      } catch (e) {
        // Fallback to ipify (just the IP)
        try {
          const r2 = await fetch("https://api.ipify.org?format=json", { credentials: "omit" });
          const d2 = await r2.json();
          setOut(out,
            `<div style="color:#ffb1bf;margin-bottom:8px;">ipapi.co didn't respond — falling back to ipify.</div>` +
            `<table><tr><th>IP address</th><td><code>${escapeHTML(d2.ip)}</code> ${copyButton(d2.ip)}</td></tr></table>`
          );
        } catch (e2) {
          setOut(out, "Couldn't reach any IP-echo service. Are you online?", true);
        }
      } finally {
        btn.disabled = false;
      }
    }
    btn.addEventListener("click", go);
    // auto-run on page load if the user navigates straight to the section
    if (location.hash === "#what-is-my-ip") setTimeout(go, 200);
  })();

  // ---- MAC OUI vendor lookup ------------------------------------------------
  // The IEEE OUI registry is ~1.4 MB raw (~400 KB gzipped). We don't load it
  // on page boot — too heavy. The first time the user runs a lookup we fetch
  // /js/oui.js dynamically, build a Map, and answer. After that it's instant.
  // Auto-fires the lookup as soon as 6 hex chars are recognised in the input
  // (debounced ~250ms) so users don't need to click the button.
  (function ouiLookup() {
    const input = $("oui-input"), btn = $("oui-go"), out = $("oui-out");
    if (!input || !btn || !out) return;
    let loaded = false, loading = null, ouiMap = null;

    function ensureLoaded() {
      if (loaded) return Promise.resolve();
      if (window.IONET_OUI_BLOB) { loaded = true; return Promise.resolve(); }
      if (loading) return loading;
      loading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        // Absolute path — works from /tools.html, /tools/network.html, anywhere
        s.src = "/js/oui.js";
        s.async = true;
        s.onload = () => { loaded = true; resolve(); };
        s.onerror = () => { loading = null; reject(new Error("oui.js failed to load")); };
        document.head.appendChild(s);
      });
      return loading;
    }
    function buildIndex() {
      if (ouiMap) return;
      ouiMap = new Map();
      const blob = window.IONET_OUI_BLOB || "";
      let i = 0;
      while (i < blob.length) {
        const sep = blob.indexOf("\x1f", i);
        const eol = blob.indexOf("\n", i);
        if (sep === -1 || eol === -1 || sep > eol) break;
        ouiMap.set(blob.slice(i, sep), blob.slice(sep + 1, eol));
        i = eol + 1;
      }
    }
    function normaliseMac(s) {
      const cleaned = s.toUpperCase().replace(/[^0-9A-F]/g, "");
      if (cleaned.length < 6) return null;
      return {
        oui: cleaned.slice(0, 6),
        formatted: cleaned.slice(0, Math.min(12, Math.floor(cleaned.length / 2) * 2)).match(/.{1,2}/g).join(":"),
      };
    }
    function render(norm) {
      const vendor = ouiMap && ouiMap.get(norm.oui);
      if (!vendor) {
        setOut(out,
          `<div style="color:var(--text-muted);">No OUI assignment found for <code>${escapeHTML(norm.oui)}</code>.</div>` +
          `<div style="margin-top:8px;font-size:0.9rem;color:var(--text-dim);">Either the prefix is unassigned (rare), uses MA-M / MA-S extended assignment (28-bit / 36-bit), or is locally-administered (the second hex digit is 2/6/A/E).</div>`
        );
        return;
      }
      const rows = [
        ["Input",         `<code>${escapeHTML(norm.formatted)}</code>`],
        ["OUI prefix",    `<code>${norm.oui.match(/.{1,2}/g).join(":")}</code>`],
        ["Vendor",        escapeHTML(vendor)],
        ["Database size", `${(window.IONET_OUI_COUNT || 0).toLocaleString()} MA-L assignments`],
      ];
      setOut(out,
        `<div style="font-size:1.1rem;color:#4ade80;margin-bottom:10px;"><strong>Vendor identified.</strong></div>` +
        "<table>" + rows.map(([k, v]) => `<tr><th>${escapeHTML(k)}</th><td>${v}</td></tr>`).join("") + "</table>" +
        `<div style="margin-top:12px;color:var(--text-dim);font-size:0.85rem;">Source: IEEE Registration Authority (<code>standards-oui.ieee.org</code>). Locally-administered, multicast, and randomised MACs won't appear in the registry.</div>`
      );
    }
    async function go() {
      const norm = normaliseMac(input.value);
      if (!norm) { setOut(out, "Provide at least 3 bytes (6 hex chars) — any of <code>AA:BB:CC</code>, <code>AA-BB-CC</code>, or <code>AABBCC</code> is fine.", true); return; }
      btn.disabled = true;
      try {
        if (!ouiMap) {
          if (!window.IONET_OUI_BLOB) {
            setOut(out, `<div style="color:var(--text-muted);font-size:0.92rem;">Loading IEEE OUI database (~400 KB gzipped, one-time)…</div>`);
          }
          await ensureLoaded();
          buildIndex();
        }
        render(norm);
      } catch (e) {
        setOut(out, "Couldn't load the OUI database: " + escapeHTML(e.message || String(e)), true);
      } finally {
        btn.disabled = false;
      }
    }
    btn.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });

    // Auto-detect: fire the lookup as soon as ≥6 hex chars present.
    // Debounced so paste / fast typing doesn't trigger many lookups.
    let debounce = null;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      const norm = normaliseMac(input.value);
      if (!norm) { setOut(out, ""); return; }
      debounce = setTimeout(go, 250);
    });

    // Run once on initial load (the field has a default value)
    if (input.value && normaliseMac(input.value)) go();
  })();

  // ===========================================================================
  // Phase 2 server-side tool clients — fetch from /api/*
  // ===========================================================================

  // ---- Port reachability ----------------------------------------------------
  (function portCheck() {
    const host = $("p2-port-host"), port = $("p2-port-port"), btn = $("p2-port-go"), out = $("p2-port-out");
    if (!host || !port || !btn || !out) return;
    btn.addEventListener("click", async () => {
      const h = host.value.trim();
      const p = parseInt(port.value, 10);
      if (!h || !Number.isFinite(p)) { setOut(out, "Provide a host and pick a port.", true); return; }
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);">Probing ${escapeHTML(h)}:${p} from the ionet network…</div>`);
      try {
        const r = await apiPost("/api/port", { host: h, port: p });
        if (!r.ok || !r.data) { setOut(out, "Server returned " + r.status + (r.data && r.data.error ? ": " + escapeHTML(r.data.error || r.data.detail) : ""), true); btn.disabled = false; return; }
        const d = r.data;
        const verdictColor = d.open ? "#4ade80" : "#ff4d6d";
        const verdictText  = d.open ? "Open" : "Closed";
        setOut(out,
          `<div style="font-size:1.15rem;color:${verdictColor};margin-bottom:10px;"><strong>${verdictText}</strong></div>` +
          "<table>" +
          `<tr><th>Host</th><td><code>${escapeHTML(d.host)}</code></td></tr>` +
          `<tr><th>Port</th><td><code>${d.port}</code></td></tr>` +
          (d.resolved_ip ? `<tr><th>Resolved IP</th><td><code>${escapeHTML(d.resolved_ip)}</code></td></tr>` : "") +
          (d.ms !== null && d.ms !== undefined ? `<tr><th>RTT</th><td><code>${d.ms} ms</code></td></tr>` : "") +
          (d.error ? `<tr><th>Error</th><td>${escapeHTML(d.error)}</td></tr>` : "") +
          "</table>"
        );
      } catch (e) { networkError(out, e); }
      btn.disabled = false;
    });
  })();

  // ---- DNS lookup -----------------------------------------------------------
  (function dnsLookup() {
    const name = $("p2-dns-name"), type = $("p2-dns-type"), server = $("p2-dns-server"), dnssec = $("p2-dns-dnssec"), btn = $("p2-dns-go"), out = $("p2-dns-out");
    if (!name || !type || !btn || !out) return;
    btn.addEventListener("click", async () => {
      const body = { name: name.value.trim(), type: type.value };
      if (server && server.value.trim()) body.server = server.value.trim();
      if (dnssec && dnssec.checked) body.dnssec = true;
      if (!body.name) { setOut(out, "Provide a DNS name.", true); return; }
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);">Querying ${escapeHTML(body.type)} for ${escapeHTML(body.name)}…</div>`);
      try {
        const r = await apiPost("/api/dns", body);
        if (!r.ok || !r.data) { setOut(out, "Server returned " + r.status, true); btn.disabled = false; return; }
        const d = r.data;
        if (d.error) { setOut(out, escapeHTML(d.error) + (d.server ? `<div style="color:var(--text-dim);font-size:0.85rem;margin-top:6px;">Resolver: ${escapeHTML(d.server)}</div>` : ""), true); btn.disabled = false; return; }
        let html = `<div style="color:var(--text-muted);font-size:0.85rem;margin-bottom:8px;">Resolver: <code>${escapeHTML(d.server)}</code>${d.dnssec_validated === true ? " · <span style=\"color:#4ade80;\">DNSSEC validated</span>" : d.dnssec_validated === false ? " · <span style=\"color:#ff4d6d;\">DNSSEC failed</span>" : ""}</div>`;
        if (!d.answers || !d.answers.length) {
          html += `<div style="color:var(--text-muted);">No ${escapeHTML(d.type)} records.</div>`;
        } else {
          html += "<table><tr><th>Type</th><th>TTL</th><th>Data</th></tr>";
          for (const a of d.answers) {
            html += `<tr><td><code>${escapeHTML(a.type)}</code></td><td><code>${a.ttl}s</code></td><td><code>${escapeHTML(a.data)}</code></td></tr>`;
          }
          html += "</table>";
        }
        setOut(out, html);
      } catch (e) { networkError(out, e); }
      btn.disabled = false;
    });
  })();

  // ---- WHOIS / RDAP ---------------------------------------------------------
  (function whoisLookup() {
    const q = $("p2-whois-q"), btn = $("p2-whois-go"), out = $("p2-whois-out");
    if (!q || !btn || !out) return;
    btn.addEventListener("click", async () => {
      const query = q.value.trim();
      if (!query) { setOut(out, "Provide a domain or IP address.", true); return; }
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);">Looking up ${escapeHTML(query)}…</div>`);
      try {
        const r = await apiPost("/api/whois", { query });
        if (!r.ok || !r.data) { setOut(out, "Server returned " + r.status, true); btn.disabled = false; return; }
        const d = r.data;
        if (d.error) { setOut(out, escapeHTML(d.error), true); btn.disabled = false; return; }
        let html = `<div style="color:var(--text-muted);font-size:0.85rem;margin-bottom:10px;">Query: <code>${escapeHTML(d.query)}</code> · Kind: <code>${escapeHTML(d.kind)}</code></div>`;
        if (d.rdap) {
          html += `<div style="color:var(--text);font-family:var(--font-heading);font-weight:600;font-size:0.95rem;margin-bottom:6px;">RDAP</div>`;
          html += `<pre style="margin:0;font-size:0.9rem;overflow-x:auto;">${escapeHTML(JSON.stringify(d.rdap, null, 2))}</pre>`;
        } else if (d.whois) {
          html += `<div style="color:var(--text);font-family:var(--font-heading);font-weight:600;font-size:0.95rem;margin-bottom:6px;">WHOIS</div>`;
          html += `<pre style="margin:0;font-size:0.9rem;overflow-x:auto;">${escapeHTML(d.whois)}</pre>`;
        }
        setOut(out, html);
      } catch (e) { networkError(out, e); }
      btn.disabled = false;
    });
  })();

  // ---- ASN / prefix lookup --------------------------------------------------
  (function asnLookup() {
    const q = $("p2-asn-q"), btn = $("p2-asn-go"), out = $("p2-asn-out");
    if (!q || !btn || !out) return;
    btn.addEventListener("click", async () => {
      const query = q.value.trim();
      if (!query) { setOut(out, "Provide an ASN, IP, or prefix.", true); return; }
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);">Looking up ${escapeHTML(query)} via RIPEstat…</div>`);
      try {
        const r = await apiPost("/api/asn", { query });
        if (!r.ok || !r.data) { setOut(out, "Server returned " + r.status, true); btn.disabled = false; return; }
        const d = r.data;
        if (d.error) { setOut(out, escapeHTML(d.error), true); btn.disabled = false; return; }
        let html = "<table>";
        if (d.asn !== null && d.asn !== undefined) html += `<tr><th>ASN</th><td><code>AS${d.asn}</code></td></tr>`;
        if (d.holder) html += `<tr><th>Holder</th><td>${escapeHTML(d.holder)}</td></tr>`;
        if (d.kind)   html += `<tr><th>Lookup kind</th><td><code>${escapeHTML(d.kind)}</code></td></tr>`;
        if (d.origin_asns && d.origin_asns.length) html += `<tr><th>Origin ASNs</th><td>${d.origin_asns.map(a => `<code>AS${a}</code>`).join(" · ")}</td></tr>`;
        html += "</table>";
        if (d.prefixes && d.prefixes.length) {
          html += `<div style="margin-top:14px;color:var(--text);font-family:var(--font-heading);font-weight:600;font-size:0.95rem;margin-bottom:6px;">Announced prefixes (${d.prefixes.length})</div>`;
          html += `<pre style="margin:0;font-size:0.9rem;max-height:300px;overflow-y:auto;">${d.prefixes.map(p => escapeHTML(p)).join("\n")}</pre>`;
        }
        setOut(out, html);
      } catch (e) { networkError(out, e); }
      btn.disabled = false;
    });
  })();

  // ---- TLS inspector --------------------------------------------------------
  (function tlsInspect() {
    const host = $("p2-tls-host"), port = $("p2-tls-port"), btn = $("p2-tls-go"), out = $("p2-tls-out");
    if (!host || !btn || !out) return;
    btn.addEventListener("click", async () => {
      const body = { host: host.value.trim(), port: parseInt((port && port.value) || "443", 10) };
      if (!body.host) { setOut(out, "Provide a hostname.", true); return; }
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);">Handshake with ${escapeHTML(body.host)}:${body.port}…</div>`);
      try {
        const r = await apiPost("/api/tls", body);
        if (!r.ok || !r.data) { setOut(out, "Server returned " + r.status, true); btn.disabled = false; return; }
        const d = r.data;
        if (d.error) { setOut(out, escapeHTML(d.error), true); btn.disabled = false; return; }
        const cert = (d.chain && d.chain[0]) || null;
        let html = `<table>`;
        html += `<tr><th>Host</th><td><code>${escapeHTML(d.host)}:${d.port}</code></td></tr>`;
        if (d.protocol) html += `<tr><th>Protocol</th><td><code>${escapeHTML(d.protocol)}</code></td></tr>`;
        if (d.cipher)   html += `<tr><th>Cipher</th><td><code>${escapeHTML(d.cipher)}</code></td></tr>`;
        html += `</table>`;
        if (cert) {
          const dr = cert.days_remaining;
          const drColor = dr < 0 ? "#ff4d6d" : dr < 14 ? "#ffb833" : "#4ade80";
          html += `<div style="margin-top:14px;color:var(--text);font-family:var(--font-heading);font-weight:600;font-size:0.95rem;margin-bottom:6px;">Certificate</div>`;
          html += `<table>`;
          html += `<tr><th>Subject</th><td><code>${escapeHTML(cert.subject)}</code></td></tr>`;
          html += `<tr><th>Issuer</th><td><code>${escapeHTML(cert.issuer)}</code></td></tr>`;
          html += `<tr><th>Serial</th><td><code>${escapeHTML(cert.serial)}</code></td></tr>`;
          html += `<tr><th>Valid from</th><td><code>${escapeHTML(cert.not_before)}</code></td></tr>`;
          html += `<tr><th>Valid until</th><td><code>${escapeHTML(cert.not_after)}</code> · <span style="color:${drColor};font-weight:600;">${dr} days remaining</span></td></tr>`;
          html += `<tr><th>Key</th><td><code>${escapeHTML(cert.key_type)}${cert.key_size ? " (" + cert.key_size + " bits)" : ""}</code></td></tr>`;
          html += `<tr><th>Sig algorithm</th><td><code>${escapeHTML(cert.signature_algorithm)}</code></td></tr>`;
          html += `<tr><th>Self-signed</th><td>${cert.is_self_signed ? "yes" : "no"}</td></tr>`;
          if (cert.sans && cert.sans.length) html += `<tr><th>SANs (${cert.sans.length})</th><td><code>${cert.sans.map(escapeHTML).join("</code> · <code>")}</code></td></tr>`;
          html += `</table>`;
        }
        setOut(out, html);
      } catch (e) { networkError(out, e); }
      btn.disabled = false;
    });
  })();

  // ---- HTTP security headers grader -----------------------------------------
  (function headersGrade() {
    const url = $("p2-headers-url"), btn = $("p2-headers-go"), out = $("p2-headers-out");
    if (!url || !btn || !out) return;
    btn.addEventListener("click", async () => {
      const u = url.value.trim();
      if (!u) { setOut(out, "Provide an https URL.", true); return; }
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);">Fetching headers from ${escapeHTML(u)}…</div>`);
      try {
        const r = await apiPost("/api/headers", { url: u });
        if (!r.ok || !r.data) { setOut(out, "Server returned " + r.status, true); btn.disabled = false; return; }
        const d = r.data;
        if (d.error) { setOut(out, escapeHTML(d.error), true); btn.disabled = false; return; }
        const gradeColor = d.grade.startsWith("A") ? "#4ade80" : d.grade === "B" ? "#a8e88b" : d.grade === "C" ? "#ffb833" : "#ff4d6d";
        const dashOffset = 528 - (d.score / 100) * 528;
        let html = `<div class="score-mock" style="margin:0 0 8px;padding:18px;">`;
        html += `<div class="score-gauge"><svg viewBox="0 0 200 200" width="160" height="160">`;
        html += `<circle cx="100" cy="100" r="84" fill="none" stroke="rgba(106,45,199,0.25)" stroke-width="14"/>`;
        html += `<circle cx="100" cy="100" r="84" fill="none" stroke="${gradeColor}" stroke-width="14" stroke-linecap="round" stroke-dasharray="528" stroke-dashoffset="${dashOffset.toFixed(1)}" transform="rotate(-90 100 100)"/>`;
        html += `<text x="100" y="92" text-anchor="middle" font-family="Outfit, sans-serif" font-size="58" font-weight="800" fill="#f5f0ff">${escapeHTML(d.grade)}</text>`;
        html += `<text x="100" y="125" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="14" fill="#b8a8d6">${d.score} / 100</text>`;
        html += `</svg><div class="score-label"><code>${escapeHTML(d.url)}</code><br><span>HTTP ${d.status} · ${d.checks.length} checks</span></div></div>`;
        html += `<ul class="score-checks">`;
        for (const c of d.checks) {
          const cls = c.score > 0 ? "ok" : c.score < -10 ? "fail" : "warn";
          const sign = c.score > 0 ? "+" : "";
          html += `<li class="${cls}"><span>${escapeHTML(c.name)}</span><span>${escapeHTML(c.note || (c.value || ""))}</span><span class="pts">${sign}${c.score}</span></li>`;
        }
        html += `</ul></div>`;
        setOut(out, html);
      } catch (e) { networkError(out, e); }
      btn.disabled = false;
    });
  })();

  // ---- BGP route inspector (Phase 2.5) --------------------------------------
  (function bgpInspector() {
    const q = $("p2-bgp-q"), btn = $("p2-bgp-go"), out = $("p2-bgp-out");
    if (!q || !btn || !out) return;
    btn.addEventListener("click", async () => {
      const query = q.value.trim();
      if (!query) { setOut(out, "Provide a prefix, IP, or ASN.", true); return; }
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);">Querying RIPE RIS collectors for ${escapeHTML(query)}…</div>`);
      try {
        const r = await apiPost("/api/bgp", { query });
        if (!r.ok || !r.data) { setOut(out, "Server returned " + r.status, true); btn.disabled = false; return; }
        const d = r.data;
        if (d.error) { setOut(out, escapeHTML(d.error), true); btn.disabled = false; return; }
        let html = "<table>";
        if (d.asn !== null && d.asn !== undefined) html += `<tr><th>Origin AS</th><td><code>AS${d.asn}</code></td></tr>`;
        if (d.holder) html += `<tr><th>Holder</th><td>${escapeHTML(d.holder)}</td></tr>`;
        if (d.prefix) html += `<tr><th>Prefix</th><td><code>${escapeHTML(d.prefix)}</code></td></tr>`;
        if (d.rpki && d.rpki.length) {
          const rp = d.rpki[0];
          const c = rp.status === "valid" ? "#4ade80" : rp.status === "invalid" ? "#ff4d6d" : "var(--text-muted)";
          html += `<tr><th>RPKI</th><td><span style="color:${c};font-weight:600;">${escapeHTML(rp.status || "—")}</span>${rp.validating_roas && rp.validating_roas.length ? ` · ${rp.validating_roas.length} ROA${rp.validating_roas.length>1?"s":""}` : ""}</td></tr>`;
        }
        if (d.rrcs_seen) html += `<tr><th>RRCs seen</th><td>${d.rrcs_seen} collector${d.rrcs_seen>1?"s":""}</td></tr>`;
        html += "</table>";
        if (d.routes && d.routes.length) {
          html += `<div style="margin-top:14px;color:var(--text);font-family:var(--font-heading);font-weight:600;font-size:0.95rem;margin-bottom:6px;">Sample BGP routes from collectors</div>`;
          html += "<table><tr><th>RRC</th><th>Location</th><th>Peer</th><th>AS path</th><th>Next hop</th></tr>";
          for (const r of d.routes.slice(0, 12)) {
            html += `<tr><td><code>${escapeHTML(r.rrc || "")}</code></td><td>${escapeHTML(r.rrc_location || "")}</td><td><code>${escapeHTML(r.peer || "")}</code></td><td><code>${escapeHTML(r.as_path || "")}</code></td><td><code>${escapeHTML(r.next_hop || "")}</code></td></tr>`;
          }
          html += "</table>";
        }
        html += `<div style="margin-top:12px;color:var(--text-dim);font-size:0.85rem;">Source: <a href="https://stat.ripe.net/" rel="noopener">RIPEstat</a> — RIPE NCC Information Service collectors.</div>`;
        setOut(out, html);
      } catch (e) { networkError(out, e); }
      btn.disabled = false;
    });
  })();

  // ---- Live traceroute (Phase 2.5) ------------------------------------------
  (function liveTrace() {
    const target = $("p2-trace-target"), btn = $("p2-trace-go"), out = $("p2-trace-out");
    if (!target || !btn || !out) return;
    btn.addEventListener("click", async () => {
      const t = target.value.trim();
      if (!t) { setOut(out, "Provide a target host or IP.", true); return; }
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);">Tracing ${escapeHTML(t)} from the ionet network — up to 60s for unreachable targets…</div>`);
      try {
        const r = await apiPost("/api/trace", { target: t, max_hops: 20 });
        if (!r.ok || !r.data) { setOut(out, "Server returned " + r.status, true); btn.disabled = false; return; }
        const d = r.data;
        if (d.error && (!d.hops || !d.hops.length)) { setOut(out, escapeHTML(d.error), true); btn.disabled = false; return; }
        let html = `<div style="color:var(--text-muted);font-size:0.85rem;margin-bottom:10px;">Target: <code>${escapeHTML(d.target)}</code>${d.resolved_ip ? ` → <code>${escapeHTML(d.resolved_ip)}</code>` : ""} · ${d.hops.length} hops · ${d.duration_s}s</div>`;
        html += "<table><tr><th>#</th><th>IP</th><th>RTT (ms)</th></tr>";
        for (const h of d.hops) {
          const ip = h.ip ? `<code>${escapeHTML(h.ip)}</code>` : `<span style="color:var(--text-dim);">*</span>`;
          const rtt = h.rtt_ms.length ? h.rtt_ms.map(x => x.toFixed(2)).join(" · ") : `<span style="color:var(--text-dim);">timeout</span>`;
          html += `<tr><td>${h.hop}</td><td>${ip}</td><td><code>${rtt}</code></td></tr>`;
        }
        html += "</table>";
        if (!d.completed) html += `<div style="margin-top:8px;color:var(--text-dim);font-size:0.85rem;">${escapeHTML(d.error || "")}</div>`;
        setOut(out, html);
      } catch (e) { networkError(out, e); }
      btn.disabled = false;
    });
  })();

  // ---- IP reputation & CVE recon (Phase 3) ----------------------------------
  (function ipRecon() {
    const ip = $("p3-ipr-ip"), btn = $("p3-ipr-go"), out = $("p3-ipr-out");
    if (!ip || !btn || !out) return;
    btn.addEventListener("click", async () => {
      const v = ip.value.trim();
      if (!v) { setOut(out, "Provide an IP address.", true); return; }
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);">Checking reputation across GreyNoise, AbuseIPDB…</div>`);
      try {
        const r = await apiPost("/api/ip-recon", { ip: v });
        if (!r.ok || !r.data) { setOut(out, "Server returned " + r.status + (r.data && r.data.detail ? ": " + escapeHTML(r.data.detail) : ""), true); btn.disabled = false; return; }
        const d = r.data;
        const score = d.risk_score, label = d.risk_label;
        const scoreColor = score == null ? "var(--text-muted)" :
                           score >= 75 ? "#ff4d6d" :
                           score >= 40 ? "#ffb833" :
                           score >= 10 ? "#ffe1ff" : "#4ade80";
        let html = `<div style="display:flex;align-items:center;gap:18px;margin-bottom:14px;">
          <div style="font-size:2.4rem;font-family:var(--font-heading);font-weight:800;color:${scoreColor};">${score == null ? "—" : score}</div>
          <div>
            <div style="color:var(--text);font-family:var(--font-heading);font-weight:600;font-size:1.05rem;">${label ? escapeHTML(label).toUpperCase() : "no signal"} risk</div>
            <div style="color:var(--text-muted);font-size:0.88rem;">composite score, 0 (clean) – 100 (high)</div>
          </div>
        </div>`;
        const gn = d.sources.greynoise || {};
        const ab = d.sources.abuseipdb || {};
        html += `<div style="color:var(--text);font-family:var(--font-heading);font-weight:600;font-size:0.95rem;margin:18px 0 6px;">GreyNoise Community</div>`;
        if (gn.responding) {
          html += `<table>` +
            `<tr><th>Classification</th><td><code>${escapeHTML(gn.classification || "—")}</code></td></tr>` +
            (gn.name ? `<tr><th>Tag</th><td>${escapeHTML(gn.name)}</td></tr>` : "") +
            (gn.last_seen ? `<tr><th>Last seen</th><td>${escapeHTML(gn.last_seen)}</td></tr>` : "") +
            (gn.note ? `<tr><th>Note</th><td>${escapeHTML(gn.note)}</td></tr>` : "") +
            (gn.link ? `<tr><th>Detail</th><td><a href="${escapeHTML(gn.link)}" rel="noopener">${escapeHTML(gn.link)}</a></td></tr>` : "") +
            `</table>`;
        } else {
          html += `<div style="color:#ffb1bf;font-size:0.9rem;">${escapeHTML(gn.error || "no response")}</div>`;
        }
        html += `<div style="color:var(--text);font-family:var(--font-heading);font-weight:600;font-size:0.95rem;margin:18px 0 6px;">AbuseIPDB</div>`;
        if (ab.responding) {
          html += `<table>` +
            `<tr><th>Abuse confidence</th><td><code>${ab.abuse_confidence_score}/100</code></td></tr>` +
            (ab.country_code ? `<tr><th>Country</th><td><code>${escapeHTML(ab.country_code)}</code></td></tr>` : "") +
            (ab.isp ? `<tr><th>ISP</th><td>${escapeHTML(ab.isp)}</td></tr>` : "") +
            (ab.usage_type ? `<tr><th>Usage</th><td>${escapeHTML(ab.usage_type)}</td></tr>` : "") +
            (ab.total_reports !== undefined ? `<tr><th>Reports (90d)</th><td><code>${ab.total_reports}</code> from ${ab.num_distinct_users} reporters</td></tr>` : "") +
            (ab.last_reported_at ? `<tr><th>Last reported</th><td>${escapeHTML(ab.last_reported_at)}</td></tr>` : "") +
            (ab.is_tor ? `<tr><th>Tor</th><td><span style="color:#ffb833;">yes</span></td></tr>` : "") +
            `</table>`;
        } else if (ab.implemented === false) {
          html += `<div style="color:var(--text-dim);font-size:0.9rem;">${escapeHTML(ab.error || "")}</div>`;
        } else {
          html += `<div style="color:#ffb1bf;font-size:0.9rem;">${escapeHTML(ab.error || "no response")}</div>`;
        }
        setOut(out, html);
      } catch (e) { networkError(out, e); }
      btn.disabled = false;
    });
  })();

  // ---- Composite Website Security Score (Phase 3) ---------------------------
  (function webScore() {
    const u = $("p3-ws-url"), btn = $("p3-ws-go"), out = $("p3-ws-out");
    if (!u || !btn || !out) return;
    btn.addEventListener("click", async () => {
      const url = u.value.trim();
      if (!url) { setOut(out, "Provide an https URL.", true); return; }
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);">Scoring ${escapeHTML(url)} — running header check + Mozilla Observatory lookup in parallel…</div>`);
      try {
        const r = await apiPost("/api/web-score", { url });
        if (!r.ok || !r.data) { setOut(out, "Server returned " + r.status, true); btn.disabled = false; return; }
        const d = r.data;
        if (d.error) { setOut(out, escapeHTML(d.error), true); btn.disabled = false; return; }
        const grade = d.composite_grade, score = d.composite_score;
        const gradeColor = grade.startsWith("A") ? "#4ade80" : grade === "B" ? "#a8e88b" : grade === "C" ? "#ffb833" : "#ff4d6d";
        const dashOffset = 528 - (score / 100) * 528;
        let html = `<div class="score-mock" style="margin:0 0 14px;padding:18px;">`;
        html += `<div class="score-gauge"><svg viewBox="0 0 200 200" width="170" height="170">`;
        html += `<circle cx="100" cy="100" r="84" fill="none" stroke="rgba(106,45,199,0.25)" stroke-width="14"/>`;
        html += `<circle cx="100" cy="100" r="84" fill="none" stroke="${gradeColor}" stroke-width="14" stroke-linecap="round" stroke-dasharray="528" stroke-dashoffset="${dashOffset.toFixed(1)}" transform="rotate(-90 100 100)"/>`;
        html += `<text x="100" y="92" text-anchor="middle" font-family="Outfit, sans-serif" font-size="58" font-weight="800" fill="#f5f0ff">${escapeHTML(grade)}</text>`;
        html += `<text x="100" y="125" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="14" fill="#b8a8d6">${score} / 100</text>`;
        html += `</svg><div class="score-label"><code>${escapeHTML(d.url)}</code><br><span>composite — headers + Mozilla Observatory</span></div></div>`;
        // Per-source breakdown
        html += `<ul class="score-checks">`;
        const h = d.headers || {};
        if (h.checks) {
          for (const c of h.checks) {
            const cls = c.score > 0 ? "ok" : c.score < -10 ? "fail" : "warn";
            const sign = c.score > 0 ? "+" : "";
            html += `<li class="${cls}"><span>${escapeHTML(c.name)}</span><span>${escapeHTML(c.note || c.value || "")}</span><span class="pts">${sign}${c.score}</span></li>`;
          }
        }
        const obs = d.observatory || {};
        if (obs.responding) {
          html += `<li class="${obs.score >= 75 ? "ok" : obs.score >= 50 ? "warn" : "fail"}"><span>Mozilla Observatory</span><span>grade ${escapeHTML(obs.grade || "—")} · ${obs.tests_passed || 0}/${(obs.tests_passed || 0) + (obs.tests_failed || 0)} tests passed · <a href="${escapeHTML(obs.report_url)}" rel="noopener">report</a></span><span class="pts">${obs.score}</span></li>`;
        } else if (obs.error) {
          html += `<li class="warn"><span>Mozilla Observatory</span><span style="color:var(--text-dim);">${escapeHTML(obs.error)}</span><span class="pts">—</span></li>`;
        }
        html += `</ul></div>`;
        setOut(out, html);
      } catch (e) { networkError(out, e); }
      btn.disabled = false;
    });
  })();

  // ---- CVE / NVD search (Phase 3) -------------------------------------------
  (function cveSearch() {
    const q = $("p3-cve-q"), btn = $("p3-cve-go"), out = $("p3-cve-out");
    if (!q || !btn || !out) return;
    btn.addEventListener("click", async () => {
      const query = q.value.trim();
      if (!query) { setOut(out, "Provide a keyword or CVE ID.", true); return; }
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);">Searching the NIST NVD…</div>`);
      try {
        const r = await apiPost("/api/cve", { query, limit: 20 });
        if (!r.ok || !r.data) { setOut(out, "Server returned " + r.status, true); btn.disabled = false; return; }
        const d = r.data;
        if (d.error) { setOut(out, escapeHTML(d.error), true); btn.disabled = false; return; }
        let html = `<div style="color:var(--text-muted);font-size:0.85rem;margin-bottom:10px;">${d.total} match${d.total === 1 ? "" : "es"}, showing ${d.items.length}</div>`;
        if (!d.items.length) {
          html += `<div style="color:var(--text-muted);">No CVEs matched. Try a more specific keyword (e.g. <code>nginx 1.18</code>) or paste a CVE ID like <code>CVE-2024-3094</code>.</div>`;
        } else {
          html += "<table><tr><th>CVE</th><th>CVSS</th><th>Description</th></tr>";
          for (const c of d.items) {
            const sevColor = c.severity === "CRITICAL" ? "#ff4d6d" :
                             c.severity === "HIGH" ? "#ff7a93" :
                             c.severity === "MEDIUM" ? "#ffb833" :
                             c.severity === "LOW" ? "#a8e88b" : "var(--text-muted)";
            const score = c.score != null ? c.score.toFixed(1) : "—";
            html += `<tr><td><a href="${escapeHTML(c.url)}" rel="noopener"><code>${escapeHTML(c.id)}</code></a></td>` +
                    `<td><span style="color:${sevColor};font-weight:600;">${score}</span> ${c.severity ? `<span style="font-size:0.78rem;color:var(--text-muted);">${escapeHTML(c.severity)}</span>` : ""}</td>` +
                    `<td>${escapeHTML(c.description)}</td></tr>`;
          }
          html += "</table>";
        }
        html += `<div style="margin-top:12px;color:var(--text-dim);font-size:0.85rem;">Source: <a href="https://nvd.nist.gov/" rel="noopener">NIST NVD API 2.0</a>.</div>`;
        setOut(out, html);
      } catch (e) { networkError(out, e); }
      btn.disabled = false;
    });
  })();

  // ---- AU outage feed -------------------------------------------------------
  (function outagesView() {
    const btn = $("p2-outages-go"), out = $("p2-outages-out");
    if (!btn || !out) return;
    async function go() {
      btn.disabled = true;
      setOut(out, `<div style="color:var(--text-muted);">Fetching aggregator snapshot…</div>`);
      try {
        const r = await apiGet("/api/outages");
        if (!r.ok || !r.data) { setOut(out, "Server returned " + r.status, true); btn.disabled = false; return; }
        const d = r.data;
        let html = `<div style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;">Refreshed: <code>${escapeHTML(d.refreshed_at || "")}</code> · Active incidents: <strong>${d.totals && d.totals.active_incidents || 0}</strong> · Feeds responding: <strong>${d.totals && d.totals.feeds_responding || 0}</strong> / ${d.totals && d.totals.feeds_implemented || 0}</div>`;
        const feeds = d.feeds || {};
        // Render order: AU first, global second, then "no feed" stubs at the bottom.
        const order = Object.keys(feeds).sort((a, b) => {
          const w = (k) => feeds[k].responding ? (k.includes("au") ? 0 : 1) : (feeds[k].implemented ? 2 : 3);
          return w(a) - w(b);
        });
        for (const name of order) {
          const f = feeds[name];
          const status = !f.implemented
            ? `<span style="color:var(--text-dim);">${escapeHTML(f.error || "no machine-readable feed")}</span>`
            : f.responding
              ? (f.events.length ? `<span style="color:#ffb833;">${f.events.length} event${f.events.length > 1 ? "s" : ""}</span>`
                                 : `<span style="color:#4ade80;">no outages</span>`)
              : `<span style="color:#ff4d6d;">no response · ${escapeHTML(f.error || "")}</span>`;
          html += `<div style="border-top:1px solid var(--border);padding:10px 0;"><strong style="text-transform:uppercase;font-family:var(--font-heading);font-size:0.92rem;">${escapeHTML(name)}</strong> · ${status}</div>`;
          if (f.events && f.events.length) {
            html += `<ul style="margin:6px 0 6px 18px;padding:0;font-size:0.9rem;color:var(--text-muted);list-style:none;">`;
            for (const ev of f.events.slice(0, 8)) {
              const where = [ev.location, ev.asn].filter(Boolean).map(escapeHTML).join(" · ");
              const when  = (ev.started || ev.published || "").slice(0, 10);
              html += `<li style="margin-bottom:6px;"><strong>${escapeHTML(ev.title || "Outage")}</strong>` +
                      (where ? ` <span style="color:var(--text-dim);">— ${where}</span>` : "") +
                      (when  ? ` <span style="color:var(--text-dim);font-size:0.85rem;">· ${escapeHTML(when)}</span>` : "") +
                      `</li>`;
            }
            html += `</ul>`;
          }
        }
        setOut(out, html);
      } catch (e) { networkError(out, e); }
      btn.disabled = false;
    }
    btn.addEventListener("click", go);
    // Auto-load when section visible the first time
    if ("IntersectionObserver" in window) {
      const wrap = btn.closest("section, article");
      if (wrap) {
        const io = new IntersectionObserver((entries) => {
          for (const e of entries) {
            if (e.isIntersecting) { go(); io.disconnect(); break; }
          }
        }, { threshold: 0.2 });
        io.observe(wrap);
      }
    }
  })();

  // ---- Hash reverse-lookup --------------------------------------------------
  // Cryptographic hashes are one-way functions: there is no mathematical
  // "unhash". The only avenue is a rainbow-table lookup — hash every entry
  // in a wordlist, compare. We bundle the SecLists top-10000 common
  // passwords (~83 KB) and check input hashes against MD5/SHA-1/256/384/512
  // of each.
  (function hashCrack() {
    const input = $("hc-input"), btn = $("hc-go"), out = $("hc-out");
    if (!input || !btn || !out) return;

    function detectAlgo(hex) {
      const h = hex.trim().toLowerCase();
      if (!/^[0-9a-f]+$/.test(h)) return null;
      switch (h.length) {
        case 32:  return { algo: "MD5",      digest: md5Digest };
        case 40:  return { algo: "SHA-1",    digest: webDigest("SHA-1") };
        case 64:  return { algo: "SHA-256",  digest: webDigest("SHA-256") };
        case 96:  return { algo: "SHA-384",  digest: webDigest("SHA-384") };
        case 128: return { algo: "SHA-512",  digest: webDigest("SHA-512") };
        default:  return null;
      }
    }
    async function md5Digest(s) { return window.IONET_MD5(s); }
    function webDigest(name) {
      return async function (s) {
        const buf = await crypto.subtle.digest(name, enc.encode(s));
        return bytesToHex(buf);
      };
    }

    async function go() {
      const target = input.value.trim().toLowerCase();
      if (!target) { setOut(out, "Paste a hash to look up.", true); return; }
      const det = detectAlgo(target);
      if (!det) {
        setOut(out, "Couldn't detect a hash algorithm from the input length. Expected 32 (MD5) / 40 (SHA-1) / 64 (SHA-256) / 96 (SHA-384) / 128 (SHA-512) hex characters.", true);
        return;
      }
      if (det.algo === "MD5" && typeof window.IONET_MD5 !== "function") {
        setOut(out, "MD5 helper not loaded. (Reload the page.)", true);
        return;
      }
      const wordlist = window.IONET_WORDLIST_TOP10K || [];
      if (!wordlist.length) {
        setOut(out, "Wordlist not loaded. (Reload the page.)", true);
        return;
      }

      btn.disabled = true;
      const startedAt = performance.now();
      setOut(out, `<div style="color:var(--text-muted);font-size:0.92rem;">Searching ${det.algo} against ${wordlist.length.toLocaleString()} common passwords…</div>`);

      // Yield to the browser every batch so the UI can paint progress
      let found = null;
      const BATCH = det.algo === "MD5" ? 1000 : 500;   // sync MD5 is faster than async webcrypto round-trip
      for (let i = 0; i < wordlist.length && !found; i += BATCH) {
        const slice = wordlist.slice(i, i + BATCH);
        for (const word of slice) {
          // For MD5 (sync), compute directly. For others (async), Promise.all is slow per-call;
          // sequential await is fine for 10k * ~50µs each.
          const hashHex = await det.digest(word);
          if (hashHex === target) { found = { word, rank: i + slice.indexOf(word) + 1 }; break; }
        }
        if (!found && i % 2000 === 0) {
          const pct = Math.min(100, Math.round((i / wordlist.length) * 100));
          setOut(out, `<div style="color:var(--text-muted);font-size:0.92rem;">Searching ${det.algo}… ${pct}%</div>`);
          // Yield to event loop so the progress text actually paints
          await new Promise(r => setTimeout(r, 0));
        }
      }
      const ms = Math.round(performance.now() - startedAt);
      btn.disabled = false;

      if (found) {
        const row = (k, v) => `<tr><th>${escapeHTML(k)}</th><td>${v}</td></tr>`;
        setOut(out,
          `<div style="font-size:1.1rem;color:#4ade80;margin-bottom:10px;"><strong>Match found.</strong></div>` +
          `<table>${row("Algorithm",     `<code>${escapeHTML(det.algo)}</code>`)}` +
          `${row("Plaintext",     `<code>${escapeHTML(found.word)}</code> ${copyButton(found.word)}`)}` +
          `${row("Wordlist rank", `#${found.rank.toLocaleString()} of ${wordlist.length.toLocaleString()}`)}` +
          `${row("Search time",   `${ms} ms`)}</table>`);
      } else {
        setOut(out,
          `<div style="font-size:1.05rem;color:var(--accent-2);margin-bottom:10px;"><strong>No match in top-${wordlist.length.toLocaleString()} common passwords.</strong></div>` +
          `<div style="color:var(--text-muted);">Searched ${det.algo} (${ms} ms). The hash isn't of a common weak password — its plaintext, if recoverable at all, requires a much larger wordlist or GPU brute-force (try <code>hashcat</code> or <code>john</code>).</div>` +
          `<div style="margin-top:14px;color:var(--text-dim);font-size:0.92rem;">Reminder: hashes are one-way. Lookup tools only succeed for already-known hash → plaintext mappings.</div>`
        );
      }
    }
    btn.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  })();

  // ---- Text ↔ Hex ↔ Binary --------------------------------------------------
  (function textconv() {
    const input = $("tx-input"), out = $("tx-out");
    if (!input || !out) return;
    function go(mode) {
      try {
        let v = input.value;
        let result = "";
        if (mode === "text2hex") {
          const arr = enc.encode(v);
          result = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join(" ");
        } else if (mode === "text2bin") {
          const arr = enc.encode(v);
          result = Array.from(arr, (b) => b.toString(2).padStart(8, "0")).join(" ");
        } else if (mode === "hex2text") {
          const cleaned = v.replace(/(?:0x|\\x)/gi, "").replace(/[\s,]+/g, "");
          if (!/^[0-9a-f]*$/i.test(cleaned) || cleaned.length % 2) throw new Error("invalid hex");
          const arr = new Uint8Array(cleaned.length / 2);
          for (let i = 0; i < arr.length; i++) arr[i] = parseInt(cleaned.substr(i*2, 2), 16);
          result = dec.decode(arr);
        } else if (mode === "bin2text") {
          const cleaned = v.replace(/[\s,]+/g, "");
          if (!/^[01]+$/.test(cleaned) || cleaned.length % 8) throw new Error("invalid binary");
          const arr = new Uint8Array(cleaned.length / 8);
          for (let i = 0; i < arr.length; i++) arr[i] = parseInt(cleaned.substr(i*8, 8), 2);
          result = dec.decode(arr);
        }
        setOut(out, copyButton(result) + escapeHTML(result));
      } catch (e) {
        setOut(out, "Conversion failed — input doesn't match the chosen format.", true);
      }
    }
    document.querySelectorAll("[data-tx]").forEach((b) => {
      b.addEventListener("click", () => go(b.getAttribute("data-tx")));
    });
  })();

})();
