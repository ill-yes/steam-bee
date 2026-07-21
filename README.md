# SteamBee

[![CI](https://github.com/ill-yes/steam-bee/actions/workflows/docker-image.yml/badge.svg?branch=main)](https://github.com/ill-yes/steam-bee/actions/workflows/docker-image.yml) [![CodeQL](https://github.com/ill-yes/steam-bee/actions/workflows/github-code-scanning/codeql/badge.svg?branch=main)](https://github.com/ill-yes/steam-bee/actions/workflows/github-code-scanning/codeql) [![GitHub Release](https://img.shields.io/github/v/release/ill-yes/steam-bee?display_name=tag)](https://github.com/ill-yes/steam-bee/releases/latest) [![GitHub Release Date](https://img.shields.io/github/release-date/ill-yes/steam-bee)](https://github.com/ill-yes/steam-bee/releases/latest) [![GitHub Last Commit](https://img.shields.io/github/last-commit/ill-yes/steam-bee/main)](https://github.com/ill-yes/steam-bee/commits/main) [![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE)

[![Container: GHCR](https://img.shields.io/badge/container-GHCR-2496ED?logo=docker&logoColor=white)](https://github.com/ill-yes/steam-bee/pkgs/container/steam-bee) [![Platforms](https://img.shields.io/badge/platform-linux%2Famd64%20%7C%20linux%2Farm64-blue?logo=linux)](docs/DEPLOYMENT.md#image-versions-and-verification) [![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-support-FFDD00?logo=buymeacoffee&logoColor=000)](https://buymeacoffee.com/ill_yes)

SteamBee is a self-hosted operations console for managing your own Steam
accounts through a Docker-friendly, single-user interface.

Legacy playtime boosting remains available for compatibility, but it is a
high-risk capability rather than the product direction. It may violate Steam
or game-service rules; operational safety controls do not make automation
compliant. Review [Product Context](PRODUCT.md) before using it.

Steam login prioritizes QR/mobile approval. A one-time credential fallback is
available only to obtain an encrypted refresh token; SteamBee does not store
Steam passwords or Steam Guard shared secrets.

The repository and container image keep the stable technical slug `steam-bee`
for package names, Compose services, volumes, and image tags. The public product
name is `SteamBee`.

SteamBee is not affiliated with, endorsed by, or sponsored by Valve Corporation
or Steam.

**Quick links:** [Screenshots](#screenshots) · [✨ Features](#-features) · [🚀 Quick Start](#-quick-start) · [Deployment](docs/DEPLOYMENT.md) · [Operations](docs/OPERATIONS.md) · [Notifications](docs/OPERATIONS.md#notifications-and-webhooks) · [Development](#development--contributing) · [🔒 Security](#-security) · [☕ Support](#-support-steambee)

## Screenshots

These screenshots use synthetic demo accounts and fake SteamIDs.

![SteamBee dashboard](docs/screenshots/steambee-dashboard.jpg)

<table>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/steambee-admin.jpg" alt="SteamBee admin area" />
    </td>
    <td width="50%">
      <img src="docs/screenshots/steambee-sign-in.jpg" alt="SteamBee sign-in" />
    </td>
  </tr>
</table>

## ✨ Features

- One-time-token-protected admin setup with a cookie-based management UI.
- Multiple own Steam accounts in one container.
- QR login via `steam-session`.
- One-time username/password + Steam Guard fallback without password
  persistence.
- Encrypted refresh-token storage in `/data`.
- Library import with manual AppID fallback.
- Start, pause, resume, and stop per account.
- Persona state and optional custom game title.
- Presets, schedules, session history, and local logs.
- Recovery health with last Steam contact, retry timing, error class, token
  expiry, and library-snapshot age.
- Session safety limits and configurable resume behavior after a real Steam
  session; limits can pause but never start a session, and daily/weekly limits
  use explicit UTC calendar boundaries.
- Seven-day schedule preview, overlap winners, skip-next, and pause-until.
- Account groups with per-account bulk results for pause and stop only.
- Local browser notifications and optional generic webhooks with private-network
  target blocking, bounded retries, and redacted payloads.
- Read-only playtime goals based on manually refreshed library snapshots.
- Passphrase-encrypted recovery exports and a preflighted offline restore tool.
- A single-instance lease that prevents two processes from operating the same
  `/data` directory.
- SSE status/log updates.
- Docker Compose setup for a VPS, Unraid, or any generic Docker host.
- Optional prebuilt image deployment through GitHub Container Registry.

## 🚀 Quick Start

Requirements:

- Docker Engine with the Docker Compose v2 plugin.
- A Docker host capable of running `linux/amd64` or `linux/arm64` images.
- An HTTPS reverse proxy when SteamBee is exposed beyond a trusted LAN or VPN;
  see [Deployment and Configuration](docs/DEPLOYMENT.md).

### Prebuilt Image (Recommended)

The public GHCR image is the shortest path for VPS and Unraid deployments. The
included image Compose file follows the mutable `latest` stable channel and
works without a `.env` file. Pin an exact version for repeatable deployments:

```bash
git clone https://github.com/ill-yes/steam-bee.git
cd steam-bee
docker compose -f compose.image.yml up -d
```

SteamBee is available on `http://127.0.0.1:3000` by default. Compose binds to
localhost so a host-based reverse proxy can publish it safely.

### First-Time Setup

The commands below use `compose.image.yml`. If you built from source, omit
`-f compose.image.yml`.

On a fresh instance, read the one-time setup token from the logs and enter it
with the new admin password:

```bash
docker compose -f compose.image.yml logs steam-bee | grep "SteamBee setup token"
```

The generated token is also stored as `/data/setup.token` with mode `0600` and
is removed after successful setup. It is printed only when first generated;
read the file after a later restart with:

```bash
docker compose -f compose.image.yml exec steam-bee cat /data/setup.token
```

Set `SETUP_TOKEN` only for automated provisioning. Configured tokens must have
8 to 256 characters and are deliberately not printed.

SteamBee stores its database, encryption secret, encrypted refresh tokens, and
Steam client data in persistent `/data` storage. The default Compose setup uses
the named volume `steam-bee-data`; preserve it across updates, include it in
your backup plan, and never bind `/data` to the checked-out repository. See
[Operations and Data](docs/OPERATIONS.md) for storage and backup guidance.

## 📚 Documentation

- [Deployment and Configuration](docs/DEPLOYMENT.md) covers source builds,
  image tags and verification, environment settings, and reverse proxies.
- [Operations and Data](docs/OPERATIONS.md) covers runtime commands, persistent
  storage, Unraid, backups, restores, and updates.
- [Back Up and Restore](docs/OPERATIONS.md#back-up-and-restore) links directly
  to the recovery procedures.
- [Security Policy](SECURITY.md) documents supported deployment boundaries and
  vulnerability reporting.
- [Contributing](CONTRIBUTING.md) covers repository hygiene, local checks, and
  contribution licensing.
- [Translations](docs/TRANSLATIONS.md) explains locale ownership and the
  community-translation status.
- [Product Context](PRODUCT.md) and [Design](DESIGN.md) define the product
  boundaries and visual system.

## Development & Contributing

### Local Development

Requirements:

- Node.js 22.
- Corepack with the repository-pinned pnpm version.
- Docker Engine with Docker Compose v2 for container-related changes.

```bash
corepack enable
pnpm install
pnpm dev
```

The server listens on `http://localhost:3000` and serves the built web app in
production. In development, run the web app separately if you want Vite HMR:

```bash
pnpm --filter @steam-bee/web dev
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) for repository hygiene and local checks,
and [CLA.md](CLA.md) before opening a pull request.

## 🔒 Security

Read [SECURITY.md](SECURITY.md) before exposing SteamBee outside localhost.

Security boundaries:

- No hosted multi-user mode.
- No Steam password persistence.
- No Steam Guard shared-secret persistence.
- No Docker socket or shell command surface.
- No forced kicking of real Steam sessions.

> [!WARNING]
> Valve's Steam Subscriber Agreement, revised April 20, 2026, expressly
> prohibits automation used to artificially increase playtime or obtain rewards
> or progress without genuine user input. SteamBee's legacy boosting and
> scheduling functions fall inside that high-risk area and can lead to account
> restrictions or termination. The operations and safety features above reduce
> operational failure modes; they do not make automated playtime boosting
> compliant. Review the current
> [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/)
> before running the software. This notice is not legal advice.

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

## ☕ Support SteamBee

If SteamBee is useful to you, you can support its continued development on Buy
Me a Coffee. Support is entirely optional.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-support-FFDD00?logo=buymeacoffee&logoColor=000)](https://buymeacoffee.com/ill_yes)
