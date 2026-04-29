# Hyperglass — BGP looking glass (Phase 2)

This directory will hold the [hyperglass](https://hyperglass.dev) configuration once we have a router (or a local FRR / BIRD container on the VM) for it to query.

## What hyperglass does

Public read-only window onto the network's routing table, exposing:

- `show ip bgp <prefix>`
- `show ip bgp summary`
- `traceroute <host>`
- `ping <host>`

…all from the perspective of one or more configured routers, with rate-limiting and a captcha gate built in.

## Files we'll add

| File | Purpose |
|------|---------|
| `hyperglass.yaml` | Site config: branding, networks, allowed query types |
| `devices.yaml` | Router targets: FRR/BIRD/Cisco/Arista with auth method (SSH key or netconf) |
| `commands.yaml` | Optional — override default per-vendor command templates |

## Bringing it online

1. Provision a router target. For Phase 2 the simplest option is **FRR** in a sibling container on the same VM, peering with a public route server (e.g. RIPE RIS) so we have a real BGP feed.
2. Drop SSH keys for hyperglass into `./hyperglass-creds/` (git-ignored).
3. Uncomment the `hyperglass:` block in `../docker-compose.yml`.
4. Uncomment the `lg.ionet.com.au` vhost in `../caddy/Caddyfile`.
5. Add a DNS A record `lg.ionet.com.au → 168.138.30.115`.
6. `docker compose up -d hyperglass caddy`.
