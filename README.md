# SteamBee

SteamBee is a self-hosted, single-user Steam hour booster with a Docker-friendly management UI.

It is built for your own Steam accounts in your own container. SteamBee does not store Steam passwords or Steam Guard shared secrets. Steam login uses QR/mobile approval first, with a one-time credential fallback only to obtain an encrypted refresh token.

The repository and container image still use the stable technical slug `steam-bee` for package names, Compose services, volumes, and image tags. The public product name is `SteamBee`.

SteamBee is not affiliated with, endorsed by, or sponsored by Valve Corporation or Steam.

## Screenshots

These screenshots use synthetic demo accounts and fake SteamIDs.

![SteamBee dashboard](docs/screenshots/steambee-dashboard.jpg)

![SteamBee admin area](docs/screenshots/steambee-admin.jpg)

![SteamBee sign-in](docs/screenshots/steambee-sign-in.jpg)

## Features

- One-time-token-protected admin setup with a cookie-based management UI.
- Multiple own Steam accounts in one container.
- QR login via `steam-session`.
- One-time username/password + Steam Guard fallback without password persistence.
- Encrypted refresh-token storage in `/data`.
- Library import with manual AppID fallback.
- Start, pause, resume, and stop per account.
- Persona state and optional custom game title.
- Presets, schedules, session history, and local logs.
- SSE status/log updates.
- Docker Compose setup for a VPS, Unraid, or any generic Docker host.
- Optional prebuilt image deployment through GitHub Container Registry.

## License

SteamBee is licensed under the GNU Affero General Public License v3.0 or later
(`AGPL-3.0-or-later`). The AGPL is a network-copyleft license: if you modify
SteamBee and let users interact with it over a network, you must make the
corresponding source code of that modified version available under the same
license.

Commercial use is allowed when the AGPL is followed. If you need to use,
modify, distribute, host, rebrand, or embed SteamBee without AGPL obligations,
contact the [project owner](https://github.com/ill-yes) for a separate
commercial license.

See [LICENSE](LICENSE), [NOTICE](NOTICE), and
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

## Local Development

```bash
pnpm install
pnpm dev
```

The server listens on `http://localhost:3000` and serves the built web app in production. In development, run the web app separately if you want Vite HMR:

```bash
pnpm --filter @steam-bee/web dev
```

## Docker Deployment

Fresh clone:

```bash
git clone https://github.com/ill-yes/steam-bee.git
cd steam-bee
docker compose up --build -d
```

The app is available on `http://127.0.0.1:3000` by default. Compose binds to localhost so the container can sit behind Nginx, Caddy, Traefik, or another reverse proxy on the same host.

Useful runtime commands:

```bash
docker compose logs -f steam-bee
curl -fsS http://127.0.0.1:3000/readyz
docker compose down
```

On a fresh instance, read the one-time setup token from the logs and enter it
with the new admin password:

```bash
docker compose logs steam-bee | grep "SteamBee setup token"
```

The generated token is also stored as `/data/setup.token` with mode `0600` and
is removed after successful setup. Set `SETUP_TOKEN` only for automated
provisioning; environment-provided tokens are deliberately not printed.

## Optional Configuration

The Compose file works without a `.env` file. Copy `.env.example` to `.env` only when you need local overrides:

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

Container-internal values stay fixed at `HOST=0.0.0.0`, `PORT=3000`, and `DATA_DIR=/data`.

For a LAN-accessible Unraid or VPS setup without a local reverse proxy, only set `STEAM_BEE_BIND=0.0.0.0` on a trusted LAN or VPN. The setup token prevents an unauthenticated first visitor from claiming a fresh instance, but the login endpoint still belongs behind an HTTPS reverse proxy for internet access.

## Prebuilt Image

The default `compose.yml` builds locally from source. To run a published image from GitHub Container Registry instead, use `compose.image.yml`.

Prefer a version tag such as `1.0.1` for repeatable deployments. Image tags do not include the Git tag's `v` prefix; `latest` is the newest stable release and `edge` tracks `main`:

```bash
STEAM_BEE_IMAGE=ghcr.io/ill-yes/steam-bee:1.0.1 docker compose -f compose.image.yml up -d
```

For ongoing use, set `STEAM_BEE_IMAGE=ghcr.io/ill-yes/steam-bee:1.0.1` in `.env` so follow-up commands such as `logs`, `ps`, and `down` use the same image reference.

The included GitHub Actions workflow verifies formatting, types, tests, Compose parity, an amd64 image smoke test, and multi-architecture builds. `main` publishes only `edge` and `sha-*`; a Git tag such as `v1.0.1` publishes `1.0.1`, `1.0`, and `latest` for `linux/amd64` and `linux/arm64`. Manual workflow runs build but do not publish. The GHCR package is public and can be pulled without authentication.

## Reverse Proxy

For HTTPS behind Nginx, Caddy, Traefik, or another reverse proxy, keep the default localhost binding and point the proxy at `127.0.0.1:3000`.

When the public URL uses HTTPS, set these values in `.env`:

```bash
TRUST_PROXY=true
COOKIE_SECURE=true
```

## Persistent Data

Compose mounts `/data` as the named volume `steam-bee-data`. It contains SQLite state, the instance encryption secret, encrypted Steam refresh tokens, and Steam client data. Do not bind this to the repository unless you know exactly what you are doing.

The container root filesystem is read-only. Only `/data` and the bounded `/tmp`
tmpfs are writable, and Docker's `json-file` logs rotate by default.

Named volumes are the supported default. On Unraid, you can replace the volume with an appdata bind mount if you want direct host-side backups:

```yaml
volumes:
  - /mnt/user/appdata/steambee:/data
```

The container runs as UID/GID `10001`. Make sure the bind-mounted directory is writable by that user, and never point `/data` at the checked-out repository.

Create a backup while the service is stopped:

```bash
mkdir -p backups
docker compose stop steam-bee
docker compose run --rm --no-deps --user 0:0 -v "$PWD/backups:/backup" steam-bee \
  sh -c 'tar czf /backup/steam-bee-data-$(date +%Y%m%d-%H%M%S).tgz -C /data .'
docker compose up -d
```

Restore a backup:

```bash
docker compose down
docker compose run --rm --no-deps --user 0:0 -v "$PWD/backups:/backup" steam-bee \
  sh -c 'rm -rf /data/* && tar xzf /backup/<backup-file>.tgz -C /data && chown -R 10001:10001 /data'
docker compose up -d
```

## Updates

Source build:

```bash
git pull
docker compose up --build -d
docker compose logs -f steam-bee
```

Prebuilt image:

```bash
docker compose -f compose.image.yml pull
docker compose -f compose.image.yml up -d
docker compose -f compose.image.yml logs -f steam-bee
```

## Git Hygiene

Never commit local runtime state or secrets. `.env`, `data/`, SQLite files, Steam client data, build outputs, and local screenshots are ignored. Before committing, these checks should be clean:

```bash
git check-ignore -v .env .env.local data apps/server/data screenshots
git ls-files -- data .env apps/server/data screenshots
```

The second command should print nothing.

Public documentation screenshots belong in `docs/screenshots/` and must use synthetic accounts only.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CLA.md](CLA.md) before opening a
pull request.

## Project Documentation

- [PRODUCT.md](PRODUCT.md) defines the target users, product boundaries, and operating model.
- [DESIGN.md](DESIGN.md) documents the interface principles and visual system.
- [docs/TRANSLATIONS.md](docs/TRANSLATIONS.md) explains locale ownership and the community-translation status.
- [SECURITY.md](SECURITY.md) covers supported deployment boundaries and vulnerability reporting.

## Security

Read [SECURITY.md](SECURITY.md) before exposing SteamBee outside localhost.

Security boundaries:

- No hosted multi-user mode.
- No Steam password persistence.
- No Steam Guard shared-secret persistence.
- No Docker socket or shell command surface.
- No forced kicking of real Steam sessions.
- No Valve or Steam affiliation.

Use at your own risk. Steam and game-specific rules can change, and automation may have account or platform consequences.
