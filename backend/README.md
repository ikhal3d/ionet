# ionet backend stack

Phase 2 services that power the server-side tools at
`tools.ionet.com.au` and `lg.ionet.com.au`. Every service runs in a
container so the whole stack is portable across VMs.

## Quickstart

```bash
cd backend
cp .env.example .env
# edit .env — add CF_API_TOKEN and TURNSTILE_SECRET when ready
docker compose up -d --build
```

## Components at a glance

| Container | Port (host) | Purpose |
|-----------|-------------|---------|
| `caddy` | `8443` | TLS terminator, reverse proxy, CORS, security headers |
| `tools-api` | internal `8000` | FastAPI: port reachability, DNS, WHOIS, ASN, TLS, headers, outages |
| `outage-aggregator` | none | Background job — pulls AU outage feeds, writes `outages.json` |
| `hyperglass` | internal `8001` | BGP looking glass (commented out until router target exists) |

## Why port 8443

The Oracle VM hosts **genesis** on 80/443 and **suzie** on 3000. We
take 8443 for the ionet stack and put **Cloudflare in front** so the
public-facing URL stays on standard 443 (Cloudflare proxies to origin
port 8443).

```
Internet  →  Cloudflare (443)  →  Oracle VM (8443)  →  caddy → tools-api
```

## Day-2 ops

| Action | Command |
|--------|---------|
| Tail logs | `docker compose logs -f` |
| Restart one service | `docker compose restart tools-api` |
| Pull + redeploy | `git pull && docker compose up -d --build` |
| Stop everything | `docker compose down` |
| Wipe Caddy certs (force re-issue) | `docker compose down && docker volume rm ionet-tools_caddy_data` |
| Manual outage refresh | `docker compose exec outage-aggregator python -c 'import job; import asyncio; asyncio.run(job.main())'` |

## Security model

Documented in [/SYSTEM_ARCHITECTURE.md §5](../SYSTEM_ARCHITECTURE.md#5-security-model). TL;DR:

| Layer | What it does |
|-------|--------------|
| Cloudflare | DDoS, WAF, Turnstile, rate-limit, hides VM IP |
| Caddy | TLS, CORS pinned to `https://ionet.com.au`, security headers |
| FastAPI | Input validation, allowlist enforcement, Turnstile token verify |
| Container | Non-root user 1000, dropped capabilities, read-only FS, tmpfs `/tmp` |
| Secrets | `.env` on the VM only (`.gitignore`d). `.env.example` is the template. |
