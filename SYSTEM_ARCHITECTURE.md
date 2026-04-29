# ionet Tools — System Architecture

This document describes how the ionet network &amp; security tools are
designed, hosted, and operated. It is the source of truth for how the
parts fit together.

---

## 1. Bird's-eye view

```
                ┌──────────────────────────────────────────────┐
                │  Public internet — visitors, search engines  │
                └────────────┬─────────────────────────────────┘
                             │ HTTPS (TLS at edge)
                             ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Cloudflare proxy in front of ionet.com.au                   │
   │  (orange-cloud DNS · TLS termination · DDoS · WAF)           │
   │                                                              │
   │  Path-based routing:                                         │
   │   /api/*  ─→ Cloudflare Worker (ionet-tools-proxy)           │
   │              forwards to https://origin.ionet.com.au:8443    │
   │                                                              │
   │   /        ─→ GitHub Pages (static frontend)                 │
   │              tools.html, /tools/<cat>.html, css, js, assets  │
   └────────────┬─────────────────────────────────────────────────┘
                │
                │ Worker → origin (DNS-only A record)
                ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Oracle VM 168.138.30.115:8443                               │
   │  (origin.ionet.com.au resolves here)                         │
   │                                                              │
   │  Docker containers:                                          │
   │   ionet_caddy           — Caddy reverse proxy                │
   │                            • TLS via Let's Encrypt DNS-01    │
   │                              (Cloudflare provider plugin)    │
   │                            • CORS pinned to ionet.com.au     │
   │                            • Routes /api/* → tools-api       │
   │                                                              │
   │   ionet_tools_api       — FastAPI                            │
   │                            • /api/port  /api/dns  /api/whois │
   │                            • /api/asn   /api/tls  /api/headers│
   │                            • /api/outages                    │
   │                                                              │
   │   ionet_outage_aggregator — feed scraper (NBN/Telstra/...)   │
   │                                                              │
   │   ionet_hyperglass       — BGP looking glass (Phase 2.5)     │
   │                              [staged — needs router target]  │
   └──────────────────────────────────────────────────────────────┘
```

| Surface | Hostname | Hosting | Status |
|---------|----------|---------|--------|
| Marketing site | `ionet.com.au` (root + paths) | GitHub Pages, Cloudflare-proxied | ✅ live |
| Tools UI | `ionet.com.au/tools.html` + `/tools/*.html` | GitHub Pages, Cloudflare-proxied | ✅ live |
| Backend API | `ionet.com.au/api/*` | Cloudflare Worker → Oracle VM Caddy → FastAPI | 🚧 Phase 2.3 cutover in progress |
| Worker origin | `origin.ionet.com.au` (DNS-only A → 168.138.30.115) | Oracle VM | ✅ DNS live |
| Looking glass | `lg.ionet.com.au` | Oracle VM (hyperglass) | ⏳ Phase 2.5 |

---

## 2. Component catalogue

### 2.1 Frontend (lives in this repo, served by GitHub Pages)

| Component | File(s) | Job |
|-----------|---------|-----|
| Tools page markup | [tools.html](tools.html) | Hero, command centre, 11 tool sections, Phase 2 teasers, CTA, full SEO head |
| Stylesheet | [css/style.css](css/style.css) | One palette, all pages — brand purple/pink/gold, command-centre styling, tool panels, responsive |
| Page bootstrap | [js/main.js](js/main.js) | Header, mobile nav, reveal-on-scroll, contact form, copy-on-click for tool outputs |
| Tool logic | [js/tools.js](js/tools.js) | All 11 tools: subnet/CIDR, VLSM, JWT, hash, HMAC, base64, URL, password, UUID, IP convert, text↔hex↔binary |
| World land path | [js/world-map.js](js/world-map.js) | Pre-projected SVG path of Natural Earth 110m land, equirectangular, ~69 KB |
| Submarine cables | [js/world-cables.js](js/world-cables.js) | Pre-projected SVG paths for 710 real submarine cables (TeleGeography), antimeridian-split, ~163 KB |
| Earth visual (home) | [js/earth.js](js/earth.js) | Three.js globe on the homepage hero |
| Australia visual (home) | [js/australia.js](js/australia.js) | Stylised AU map on the home about-section |

### 2.2 Backend (Phase 2 — lives in `backend/` of this repo, runs on Oracle VM)

> All backend services run as **Docker containers**, orchestrated by
> a single `docker compose` stack. The VM can be moved or rebuilt
> with `git clone && cp .env.example .env && docker compose up -d`.

| Container | Image | Job |
|-----------|-------|-----|
| `caddy` | `caddy:2-alpine` | TLS termination (Let's Encrypt via Cloudflare DNS-01), reverse proxy, CORS headers, app-level rate limit |
| `tools-api` | built from `backend/tools-api/` | FastAPI service with all server-side tools — port reachability, WHOIS/RDAP, DNS, ASN, TLS, security-headers |
| `hyperglass` | `ghcr.io/thatmattlove/hyperglass` | BGP looking glass — `show ip bgp`, traceroute, ping from our routers |
| `outage-aggregator` | built from `backend/outage-aggregator/` | Scheduled job — pulls NBN, Telstra, Optus, TPG, Aussie Outages feeds; writes `/var/data/outages.json` |

### 2.3 External dependencies

| Dependency | Used for | Purpose |
|------------|----------|---------|
| Cloudflare (free tier) | Edge proxy | DDoS scrubbing, hides VM IP, free TLS (alt path), Turnstile captcha, edge rate limit |
| Cloudflare Turnstile | Frontend captcha | Proves real human, not a bot — gates expensive endpoints |
| TeleGeography cable data | Command centre map | 710 real submarine cable routes, CC-BY-SA 4.0 |
| Natural Earth (world-atlas) | Command centre map | World land silhouette, public domain |
| PCH IXP database | Command centre map | List of major Internet Exchange Points |

---

## 3. Tools inventory

### 3.1 Phase 1 tools — client-side, ship today

| Tool | Anchor | What it does | Where it runs |
|------|--------|--------------|---------------|
| Subnet / CIDR calculator | `#subnet-calculator` | Network, broadcast, range, mask, wildcard, host count, RFC1918 detect | Browser |
| VLSM planner | `#vlsm-planner` | Allocate variable-length subnets from a parent, largest-first | Browser |
| JWT decoder | `#jwt-decoder` | Decode JWT header + payload, exp/iat/nbf annotated | Browser |
| Hash generator | `#hash-generator` | SHA-1, SHA-256, SHA-384, SHA-512 via Web Crypto API | Browser |
| HMAC-SHA256 | `#hmac-generator` | Keyed-hash MAC, hex + Base64 output | Browser |
| Base64 | `#base64` | Encode/decode | Browser |
| URL encoder | `#url-encode` | Percent encode/decode | Browser |
| Password generator | `#password-generator` | Cryptographically secure, configurable charset | Browser |
| UUID v4 | `#uuid-generator` | RFC 4122 UUID v4 | Browser |
| IP converter | `#ip-converter` | IPv4 dotted-quad ↔ decimal ↔ hex ↔ binary | Browser |
| Text converter | `#text-converter` | ASCII ↔ hex ↔ binary | Browser |

### 3.2 Phase 2 tools — server-side, need the VM

| Tool | Endpoint | What it does | Notes |
|------|----------|--------------|-------|
| BGP looking glass | `lg.ionet.com.au` | `show ip bgp`, AS-path, ping/traceroute from our network | Hyperglass; needs a real router or FRR/BIRD on the VM announcing a test prefix |
| TCP port reachability | `POST /api/port` | Check whether one well-known port is open on a target | Allowlist of ports; rejects RFC1918; Turnstile-gated |
| Traceroute / MTR | `POST /api/trace` | Layer-3 path with hop loss/latency from our PoP | `CAP_NET_RAW` only, never root |
| DNS / DNSSEC | `POST /api/dns` | A, AAAA, MX, TXT, NS, CNAME, SOA, CAA, SRV, PTR with DNSSEC validation | dnspython |
| WHOIS / RDAP | `POST /api/whois` | Domain & IP registration, RDAP-first | python-whois fallback |
| ASN / prefix lookup | `POST /api/asn` | AS announcements, peers, hijack alerts | pyasn local DB + RIPEstat |
| TLS chain inspector | `POST /api/tls` | Certificate chain, expiry, key strength, ciphers, HSTS, CAA, OCSP | cryptography stdlib |
| HTTP security headers | `POST /api/headers` | Grade headers like Mozilla Observatory does | Custom |
| Australian outage status | `GET /api/outages` | Aggregated NBN / Telstra / Optus / TPG status | Background job, cached |

---

## 4. Request flow — typical Phase 2 call

```
User clicks "Check port 443 on example.com"
        │
        ▼
┌────────────────────────────────────────────┐
│ Browser (ionet.com.au/tools.html)          │
│                                            │
│ 1. Render Turnstile widget invisibly       │
│ 2. POST {host, port, turnstile_token}      │
│    to https://tools.ionet.com.au/api/port  │
└────────────────┬───────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────┐
│ Cloudflare edge                            │
│                                            │
│ • Verifies the request hits the WAF rules  │
│ • Per-IP rate limit (e.g. 30 req/min)      │
│ • Forwards to origin: VM:8443              │
└────────────────┬───────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────┐
│ Oracle VM — caddy container                │
│                                            │
│ • TLS termination                          │
│ • CORS: only Origin: ionet.com.au allowed  │
│ • Strips/sets security headers             │
│ • Reverse-proxies /api/* → tools-api:8000  │
└────────────────┬───────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────┐
│ tools-api (FastAPI, non-root)              │
│                                            │
│ • Verifies Turnstile token w/ Cloudflare   │
│ • Validates host (no RFC1918, no loopback) │
│ • Validates port (in allowlist)            │
│ • asyncio.open_connection w/ 5s timeout    │
│ • Logs {ip, host, port, ts, result}        │
│ • Returns JSON: {open, ms, error}          │
└────────────────────────────────────────────┘
```

---

## 5. Security model

Defence in depth. Each layer can fail without the system as a whole
becoming a free attack tool with ionet's name on it.

```
┌──── Layer 1 — Edge ────────────────────────────────────────────┐
│  Cloudflare WAF, Turnstile captcha, per-IP rate limit,         │
│  origin IP hidden, automatic DDoS scrubbing                    │
└────────────────────────────────────────────────────────────────┘
┌──── Layer 2 — Reverse proxy (caddy) ───────────────────────────┐
│  TLS, CORS allow-list, strict security headers, app rate limit │
└────────────────────────────────────────────────────────────────┘
┌──── Layer 3 — Application (FastAPI) ───────────────────────────┐
│  Input validation, allow-listed ports/types, RFC1918 reject,   │
│  Turnstile token verification, structured logging              │
└────────────────────────────────────────────────────────────────┘
┌──── Layer 4 — Container hardening ─────────────────────────────┐
│  Non-root user, capabilities dropped (only NET_RAW where       │
│  needed), read-only filesystem, tmpfs for /tmp                 │
└────────────────────────────────────────────────────────────────┘
┌──── Layer 5 — Secrets ─────────────────────────────────────────┐
│  .env on VM (git-ignored), .env.example in repo, mounted into  │
│  containers via env_file. No secret ever touches the frontend. │
└────────────────────────────────────────────────────────────────┘
```

| Threat | Mitigation |
|--------|------------|
| Free port-scan-as-a-service abuse | Turnstile + rate limit + ToS checkbox + port allowlist + no scan ranges |
| Volumetric DDoS of the VM | Cloudflare absorbs — VM IP never appears in DNS |
| Cross-origin abuse from a clone site | CORS pinned to `https://ionet.com.au` |
| Stolen secrets in repo | `.env` is `.gitignore`d; pre-commit secret scan |
| Container escape from a tool | Non-root, dropped caps, read-only FS, tmpfs |
| Hyperglass router compromise | Read-only commands only; SSH key with restricted shell |
| Backdoor via supply chain | Pinned dependency versions; Dependabot alerts |

---

## 6. Repository layout

```
ionet/
├── README.md
├── SYSTEM_ARCHITECTURE.md          ← this document
│
├── index.html · about.html         ─┐
├── tools.html · contact.html       ─┤
├── css/  js/  assets/              ─┼─  Static frontend (GitHub Pages)
├── sitemap.xml · robots.txt        ─┤
├── site.webmanifest                ─┘
│
├── backend/                        ─── Phase 2 — runs on Oracle VM only
│   ├── docker-compose.yml          ───  one-command stack
│   ├── .env.example                ───  secrets template (real .env never commits)
│   ├── README.md                   ───  ops runbook for the backend
│   │
│   ├── caddy/
│   │   └── Caddyfile               ───  TLS, CORS, rate-limit, vhosts
│   │
│   ├── tools-api/                  ───  FastAPI service
│   │   ├── Dockerfile
│   │   ├── pyproject.toml
│   │   └── app/
│   │       ├── main.py
│   │       └── routers/
│   │           ├── port.py · dns.py · whois.py · asn.py
│   │           └── tls.py · headers.py · outages.py · health.py
│   │
│   ├── hyperglass/                 ───  BGP looking glass
│   │   ├── hyperglass.yaml
│   │   └── devices.yaml
│   │
│   └── outage-aggregator/          ───  AU outage feed scraper
│       ├── Dockerfile
│       └── job.py
│
└── .gitignore                      ───  excludes backend/.env, backend/data/, *.log
```

GitHub Pages serves the repository root and ignores anything not
linked from the site — `backend/` is invisible to web visitors but
publicly readable on GitHub itself, which is fine for source code
(it is **never** fine for secrets — those live only on the VM).

---

## 7. Phasing &amp; roadmap

| Phase | Status | Scope |
|-------|--------|-------|
| **Phase 1** | ✅ shipped | 11 client-side tools, command centre with real world map and 710 real cables |
| **Phase 1.5** | in progress | Cleaner IXP labels, AU-zoom inset panel, AU outage placeholders |
| **Phase 2** | next | Backend stack on the VM: caddy + FastAPI tools-api + hyperglass + outage-aggregator |
| **Phase 3** | future | Live BGP advisory feed (Cloudflare Radar / RIPE RIS), live cable status (TeleGeography events), public API tier with API keys |
| **Phase 4** | future | Account-backed features: saved scans, scheduled checks, alert webhooks |

---

## 8. Operational notes

| Topic | Approach |
|-------|----------|
| Deploys (frontend) | `git push` to `main` — GitHub Pages rebuilds in ~30–60s |
| Deploys (backend) | `git pull && docker compose up -d --build` on the VM |
| Logs | Container stdout → `docker compose logs -f`; persistent JSON access logs in caddy volume |
| Backups | Cable / world data is reproducible from upstream; `.env` and outage cache backed up to encrypted S3-compatible bucket |
| Monitoring | Phase 2: Uptime Kuma container watching `/healthz` of each service |
| Cost | GitHub Pages free, Oracle VM free tier, Cloudflare free tier — total recurring spend $0 |
| Disk pressure | Oracle VM root is currently 83% used (unrelated workloads). Watch with `df -h /`; 7.7 GB free. |

---

## 9. Glossary

| Term | Meaning |
|------|---------|
| **IXP** | Internet Exchange Point — physical location where networks peer (e.g. AMS-IX, Sydney IX) |
| **BGP** | Border Gateway Protocol — how the internet's autonomous systems exchange reachability |
| **AS / ASN** | Autonomous System / its number — a routing entity (Telstra is AS1221, Cloudflare AS13335) |
| **Looking glass** | Read-only window onto a network's BGP routing table & basic reachability tests |
| **Route leak** | An AS announces routes it shouldn't, redirecting traffic incorrectly |
| **Prefix hijack** | An AS announces an IP block it doesn't own |
| **VLSM** | Variable-Length Subnet Masking — using different prefix lengths for different subnets |
| **CIDR** | Classless Inter-Domain Routing — the `192.168.0.0/24` notation |
| **HMAC** | Hash-based Message Authentication Code |
| **JWT** | JSON Web Token — a signed/encoded JSON blob used for auth |
| **Turnstile** | Cloudflare's privacy-preserving captcha |
| **CORS** | Cross-Origin Resource Sharing — browser-enforced rule on which origins can call an API |
| **CAP_NET_RAW** | Linux capability needed to send ICMP / craft raw sockets — for traceroute |
| **DNS-01** | Let's Encrypt challenge type that proves domain ownership via a DNS TXT record (works when port 80/443 is busy) |
| **RFC1918** | Reserved private IP ranges (10/8, 172.16/12, 192.168/16) — never routed on the public internet |
