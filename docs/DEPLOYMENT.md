# Deployment and Configuration

This guide covers advanced SteamBee deployment and configuration. For the
shortest supported installation path, start with the
[Quick Start](../README.md#-quick-start). Runtime commands, persistent data,
backups, and updates are covered in [Operations and Data](OPERATIONS.md).

Run all commands from the repository root unless a command explicitly changes
directories.

## Build From Source

Build the same runtime image locally instead of pulling it from GHCR:

```bash
git clone https://github.com/ill-yes/steam-bee.git
cd steam-bee
docker compose up --build -d
```

The service uses the default address, `http://127.0.0.1:3000`.

## Image Versions and Verification

[`compose.image.yml`](../compose.image.yml) defaults to
`ghcr.io/ill-yes/steam-bee:1.0.5`. Override the pin in `.env` when you want to
select another release:

```bash
STEAM_BEE_IMAGE=ghcr.io/ill-yes/steam-bee:1.0.5
```

Exact version tags are recommended for repeatable deployments. Image tags do
not include the Git tag's `v` prefix: `1.0` tracks the latest `1.0.x` patch,
and `latest` tracks the newest stable release.

The read-only CI workflow verifies formatting, types, tests, dependency and
image vulnerabilities, Compose parity, runtime UID/GID, the Unraid template,
and both standard and PUID/PGID image smoke tests. Pushes and pull requests never
publish images. Releases are started explicitly with the **Release** workflow's
**Run workflow** action on `main`: enter `1.0.5` and enable **Publish the release
image to GHCR**. The version input selects `refs/tags/v1.0.5` as the exact build
target. An annotated or signed version tag is recommended, but merely pushing
the tag does not publish anything. The workflow rejects tags that are not
reachable from `origin/main`, then runs the same quality gate, image scan, and
smoke test against the tag before it publishes `1.0.5`, `1.0`, and `latest` for
`linux/amd64` and `linux/arm64`. It then creates the corresponding GitHub
Release. Releases are serialized so an older build cannot overwrite `latest`
after a newer one. Published images include SBOM, provenance, and a GitHub
artifact attestation. The publish job uses the GitHub `release` environment;
repository administrators can optionally add required reviewers or other
deployment protection rules there. The GHCR package is public and can be pulled
without authentication.

Verify a published image against this repository with the GitHub CLI:

```bash
gh attestation verify oci://ghcr.io/ill-yes/steam-bee:1.0.5 \
  --repo ill-yes/steam-bee
```

## Optional Configuration

The Compose file works without a `.env` file. Copy
[`.env.example`](../.env.example) to `.env` only when you need local overrides:

```bash
cp .env.example .env
```

Runtime defaults:

- `STEAM_BEE_BIND=127.0.0.1`
- `STEAM_BEE_PORT=3000`
- `TRUST_PROXY=false`
- `COOKIE_SECURE=false`
- `LOG_LEVEL=info`
- `LOG_REQUESTS=true`
- `LOG_QUIET_REQUESTS=true`
- `EVENT_RETENTION_DAYS=90` (`0` disables cleanup)
- `DOCKER_LOG_MAX_SIZE=10m`
- `DOCKER_LOG_MAX_FILE=3`

Container-internal values stay fixed at `HOST=0.0.0.0`, `PORT=3000`, and
`DATA_DIR=/data`.

For a LAN-accessible Unraid or VPS setup without a local reverse proxy, only
set `STEAM_BEE_BIND=0.0.0.0` on a trusted LAN or VPN. The setup token prevents
an unauthenticated first visitor from claiming a fresh instance, but the login
endpoint still belongs behind an HTTPS reverse proxy for internet access.

## Reverse Proxy

For a reverse proxy running directly on the Docker host, keep the default
localhost binding and point the proxy at `127.0.0.1:3000`.

For a reverse proxy running in another container, attach both services to the
same external Docker network and use `steam-bee:3000` as the upstream. For
example, create `compose.proxy.yml`:

```yaml
services:
  steam-bee:
    networks:
      - proxy

networks:
  proxy:
    external: true
```

Create the network once and include the override when starting SteamBee:

```bash
docker network create proxy
docker compose -f compose.image.yml -f compose.proxy.yml up -d
```

Use the existing external network name instead of `proxy` when your Caddy,
Nginx Proxy Manager, SWAG, or Traefik installation already provides one.

When the public URL uses HTTPS behind exactly one reverse proxy, set these
values in `.env`:

```bash
TRUST_PROXY=1
COOKIE_SECURE=true
```

`TRUST_PROXY` accepts a positive proxy-hop count or a comma-separated list of
trusted IP addresses/CIDRs. Do not expose the application port directly when
proxy trust is enabled, and configure the proxy to replace forwarded headers
instead of appending untrusted client values.

Keep response buffering disabled in Nginx-compatible proxies so SSE status and
log updates are delivered immediately. SteamBee also sends
`X-Accel-Buffering: no` on SSE responses.

Continue with [Operations and Data](OPERATIONS.md) for runtime commands,
persistent storage, backups, and updates.
