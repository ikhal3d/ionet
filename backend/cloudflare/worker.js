/**
 * ionet — Cloudflare Worker that proxies /api/* on ionet.com.au to the
 * Oracle VM backend. Everything else falls through to GitHub Pages
 * (the static frontend).
 *
 * Deployment options:
 *   1) Named Cloudflare Tunnel — set ORIGIN to the tunnel URL
 *      (https://api.ionet.com.au if you map a CNAME, or the named
 *      tunnel's hostname).
 *   2) Direct VM origin — set ORIGIN to https://<vm-ip>:8443 with
 *      Caddy serving Let's Encrypt via DNS-01 (production Caddyfile).
 *      Hide the VM IP via Cloudflare proxy on a host like
 *      origin.ionet.com.au pointed at the VM.
 *
 * Bind it on the route  ionet.com.au/api/*  via wrangler.toml or
 * the Cloudflare dashboard.
 *
 * Security:
 *   - Only forwards on /api/* — anything else passes through to Pages.
 *   - Pins CORS to https://ionet.com.au.
 *   - Rate-limit (Cloudflare WAF rule, configured outside the Worker).
 *   - Optional: Turnstile token verification before forwarding.
 */

const ORIGIN          = "https://origin.ionet.com.au:8443";   // Oracle VM behind DNS-only A record
const ALLOWED_ORIGIN  = "https://ionet.com.au";
const REQUIRE_TURNSTILE = false;                          // flip to true once tools.html embeds the site key
const TURNSTILE_SECRET  = "";                             // set via `wrangler secret put TURNSTILE_SECRET`

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only handle /api/* — let everything else fall through to Pages
    if (!url.pathname.startsWith("/api/")) {
      return fetch(request);
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // Optional: verify Cloudflare Turnstile token before forwarding.
    if (REQUIRE_TURNSTILE && (request.method === "POST")) {
      const token = request.headers.get("X-Turnstile-Token");
      if (!await verifyTurnstile(token, request, env)) {
        return jsonError(403, "turnstile verification failed");
      }
    }

    // Build the upstream request
    const upstreamUrl = ORIGIN + url.pathname + url.search;
    const upstreamRequest = new Request(upstreamUrl, request);

    // Strip headers the origin shouldn't see / log
    upstreamRequest.headers.delete("cf-connecting-ip");
    upstreamRequest.headers.set("X-Forwarded-Host", url.host);

    let response;
    try {
      response = await fetch(upstreamRequest);
    } catch (e) {
      return jsonError(502, "upstream unreachable: " + e.message);
    }

    // Re-emit response with our CORS headers attached
    const out = new Response(response.body, response);
    Object.entries(corsHeaders()).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Turnstile-Token",
    "Vary":                         "Origin",
  };
}

function jsonError(status, msg) {
  return new Response(
    JSON.stringify({ error: msg }),
    {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders() }
    }
  );
}

async function verifyTurnstile(token, request, env) {
  if (!token) return false;
  const secret = env.TURNSTILE_SECRET || TURNSTILE_SECRET;
  if (!secret) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) form.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  if (!r.ok) return false;
  const body = await r.json();
  return Boolean(body.success);
}
