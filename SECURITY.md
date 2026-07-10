# Security Policy

SteamBee is a self-hosted, single-user tool. Do not expose it directly to the
internet without HTTPS, a reverse proxy, and host-level firewall rules.

Fresh instances require the one-time setup token written to `/data/setup.token`
and printed once when it is generated. The generated file uses mode `0600` and
is removed after successful setup. A setup token protects the first-admin flow
but does not replace HTTPS or network access controls.

## Supported Versions

Security fixes target the latest stable release and the current `main` branch.
Older releases may no longer receive fixes.

## Reporting a Vulnerability

If you find a security issue, please do not publish exploit details publicly
before there is a fix. Use
[GitHub private vulnerability reporting](https://github.com/ill-yes/steam-bee/security/advisories/new)
instead of a public issue.

Please include:

- affected version or commit
- deployment mode, for example Docker Compose or prebuilt image
- steps to reproduce
- expected impact
- relevant logs with secrets, session cookies, Steam account names, refresh
  tokens, and local paths removed

## Sensitive Runtime Data

Never share or commit:

- `.env` files
- `/data` contents
- `steam-bee.sqlite` or SQLite WAL/SHM files
- `instance.secret`
- Steam refresh tokens
- screenshots that show real Steam account names or SteamIDs

## Supported Deployment

The supported deployment path is Docker Compose with persistent `/data`
storage. Public internet deployments should put SteamBee behind a reverse
proxy and set `TRUST_PROXY=1` and `COOKIE_SECURE=true` when served over HTTPS
through one trusted proxy. Keep the application port inaccessible from
untrusted networks and use an exact hop count or trusted CIDR list for more
complex proxy chains.

The standard image runs as UID/GID `10001`; the supported Compose files also
drop all capabilities. The Unraid template starts a restricted ownership
helper for `/data`, then drops to its configured PUID/PGID with an empty
capability set before Node starts. Its healthcheck applies the same privilege
drop. Ownership initialization is fail-closed: `/data` must be a dedicated,
empty or recognizable SteamBee mount without nested mounts, hardlinks,
symlinks, special files, or unrelated top-level entries.
