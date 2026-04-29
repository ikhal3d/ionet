# Caddy with the cloudflare DNS provider compiled in (needed for the
# DNS-01 challenge — port 80 is busy on this VM, so we can't use HTTP-01).
#
# Source plugin: https://github.com/caddy-dns/cloudflare

FROM caddy:2-builder AS builder
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
