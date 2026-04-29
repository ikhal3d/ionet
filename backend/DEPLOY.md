# ionet backend — production deployment runbook

Step-by-step for taking the backend stack from "running locally on the Oracle VM" (Phase 2.1 / 2.2) to "live on `ionet.com.au/api/*`" (Phase 2.3).

What you do in dashboards is on the **left**; what I (or anyone with shell on the VM) do is on the **right**.

---

## 1. Cloudflare prerequisites

| Step | Action | Where |
|------|--------|-------|
| 1.1 | Confirm `ionet.com.au` is on Cloudflare. If not, transfer the zone or change name servers to Cloudflare's. | Cloudflare dashboard → Add a Site |
| 1.2 | Create a Turnstile site/secret pair (Free, "Managed" widget). Copy both keys. | Cloudflare dashboard → Turnstile |
| 1.3 | Create a Cloudflare API token with these scopes — **Zone → DNS → Edit** for `ionet.com.au` only. Copy the token. | Cloudflare dashboard → My Profile → API Tokens |

---

## 2. DNS

Add **one** A record. Either of the two paths below works.

| Path | DNS A record | Cloudflare proxy |
|------|--------------|------------------|
| **Worker proxy (recommended)** — Worker is the only thing that ever touches the VM | `origin.ionet.com.au → 168.138.30.115` | **DNS-only** (grey cloud) |
| Direct CF-proxied subdomain | `api.ionet.com.au → 168.138.30.115` | Proxied (orange cloud) |

The **recommended** path keeps `api.ionet.com.au` out of public DNS — only the Worker (running inside Cloudflare) knows about `origin.ionet.com.au`.

---

## 3. Open the port on the Oracle VM

The genesis container holds 80/443 and Suzie holds 3000. Backend uses **8443**.

| Step | Action | Where |
|------|--------|-------|
| 3.1 | Add an ingress rule to the VCN security list — TCP port 8443 from `0.0.0.0/0` (or restrict to Cloudflare's IP ranges if you want — list at https://www.cloudflare.com/ips-v4) | OCI console → Networking → VCN → Security Lists |
| 3.2 | Open the port in the host firewall: `sudo iptables -I INPUT -p tcp --dport 8443 -j ACCEPT && sudo netfilter-persistent save` | SSH to the VM |

---

## 4. Switch Caddy from local-test to production

On the VM:

```bash
cd ~/ionet/backend
# Pull the latest from git (this DEPLOY.md, the production Caddyfile,
# the worker source).
git pull --rebase

# Edit .env:
#   CADDY_CONFIG=Caddyfile           # was Caddyfile.local
#   CF_API_TOKEN=<the token from §1.3>
#   ACME_EMAIL=admin@ionet.com.au
#   FRONTEND_ORIGIN=https://ionet.com.au
#   TURNSTILE_SITE_KEY=<from §1.2>
#   TURNSTILE_SECRET=<from §1.2>
#   REQUIRE_TURNSTILE=true
nano .env

# Drop the Cloudflare quick-tunnel — Worker takes over from here.
docker compose stop cloudflared
docker compose rm -f cloudflared

# Reload Caddy with the production Caddyfile
docker compose up -d caddy

# Watch Caddy obtain a cert via DNS-01
docker compose logs -f caddy
# Expect: "obtained certificate" within ~30s.
```

---

## 5. Deploy the Cloudflare Worker

```bash
cd backend/cloudflare

# Edit worker.js — set ORIGIN to the host you set up in §2:
#   const ORIGIN = "https://origin.ionet.com.au:8443";   // or https://api.ionet.com.au if proxied
nano worker.js

# Set secrets (these never appear in code or git):
npx wrangler@latest login                       # one-time, opens browser
npx wrangler@latest secret put TURNSTILE_SECRET # paste the secret from §1.2

# Deploy
npx wrangler@latest deploy
```

Then in the Cloudflare dashboard:

| Step | Action | Where |
|------|--------|-------|
| 5.1 | Bind the Worker `ionet-tools-proxy` to the route `ionet.com.au/api/*` | Workers & Pages → Your Worker → Triggers → Add Route |

---

## 6. Verify

```bash
# From any machine — these should all work and route through the Worker:
curl https://ionet.com.au/api/dns -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"cloudflare.com","type":"A"}'

curl https://ionet.com.au/api/asn -X POST \
  -H "Content-Type: application/json" \
  -d '{"query":"AS13335"}'
```

Then in the browser:

| Step | Action |
|------|--------|
| 6.1 | Visit `https://ionet.com.au/tools/live.html` and trigger any tool — DNS, port, headers, etc. |
| 6.2 | Open DevTools → Network and confirm requests go to `https://ionet.com.au/api/*` (same-origin, no CORS preflight). |

---

## 7. Day-2

| Topic | How |
|-------|-----|
| Logs (backend) | `docker compose logs -f` on the VM |
| Logs (Worker) | Cloudflare dashboard → Worker → Logs (live tail) |
| Update backend | `git pull && docker compose up -d --build` on the VM |
| Update Worker | edit `worker.js`, run `npx wrangler deploy` |
| Rotate Turnstile secret | `npx wrangler secret put TURNSTILE_SECRET` |
| Rotate CF API token | regenerate in CF dashboard, update `.env`, `docker compose up -d caddy` |
| Restrict to CF IPs only | replace the iptables ACCEPT rule with a list of CF IP ranges |

---

## Architecture reference

```
                ┌──────────────────────────────────────┐
                │  Browser   →  ionet.com.au           │
                └─────────────────┬────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────┐
   │  Cloudflare edge                                     │
   │   ├─ /api/*  ─→ Worker (ionet-tools-proxy)           │
   │   └─ everything else ─→ GitHub Pages                 │
   └────────────────┬──────────────────────────────────────┘
                    │ Worker forwards to ORIGIN
                    ▼
   ┌──────────────────────────────────────────────────────┐
   │  Oracle VM 168.138.30.115:8443                       │
   │  Caddy (TLS via DNS-01) → tools-api (FastAPI)        │
   │                         → outage-aggregator          │
   │                         → hyperglass (later)         │
   └──────────────────────────────────────────────────────┘
```

See [SYSTEM_ARCHITECTURE.md](../SYSTEM_ARCHITECTURE.md) for the full security model and request flow.
