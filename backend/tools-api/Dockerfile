FROM python:3.12-slim

WORKDIR /app

# System packages: traceroute (uses raw sockets, needs CAP_NET_RAW), curl for healthchecks.
RUN apt-get update && apt-get install -y --no-install-recommends \
        traceroute \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --no-cache-dir uv \
 && uv pip install --system .

COPY app/ ./app

# Drop to non-root early
RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin ionet \
 && chown -R 1000:1000 /app
USER 1000:1000

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
