/* ionet tools — pure client-side utilities. Nothing sent to a server. */
(function () {
  "use strict";

  // ---- Helpers --------------------------------------------------------------
  const $  = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const dec = new TextDecoder();

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
