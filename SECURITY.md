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
proxy and set `COOKIE_SECURE=true` when served over HTTPS. Set `TRUST_PROXY`
to the verified proxy IP addresses or narrowly scoped CIDRs as seen by SteamBee;
the default `false` ignores forwarded headers. Numeric hop counts and
`true`/`yes`/`on` aliases are rejected because they cannot verify the immediate
peer. Keep the application port inaccessible from untrusted networks and
configure trusted proxies to replace untrusted forwarded headers.

The standard image runs as UID/GID `10001`; the supported Compose files also
drop all capabilities. The Unraid template starts a restricted ownership
helper for `/data`, then drops to its configured PUID/PGID with an empty
capability set before Node starts. Its healthcheck applies the same privilege
drop. Ownership initialization is fail-closed: `/data` must be a dedicated,
empty or recognizable SteamBee mount without nested mounts, hardlinks,
symlinks, special files, or unrelated top-level entries.

## Operational Security Boundaries

- A heartbeat lease prevents concurrent SteamBee processes from sharing one
  `/data` directory.
- Generic webhook delivery rejects credentials in URLs, redirects, and targets
  resolving to loopback, private, link-local, multicast, or reserved IP space.
  Delivery payloads contain only a local event ID, event type, and timestamp;
  raw event messages, account identifiers, and rule secrets are excluded.
- Encrypted recovery exports use a per-backup salt, scrypt key derivation, and
  AES-256-GCM authentication. Restore remains an offline operation with staging,
  integrity checks, migration compatibility checks, and a retained rollback.
- Setup tokens, `instance.secret`, portable `.sbb` backups, instance leases,
  restore staging, and restore rollback material remain sensitive even outside
  the default `/data` directory. Keep them outside the source checkout; matching
  leaf names are excluded from Git and Docker build contexts as defense in depth.
- Browser notification permission is requested only after an explicit operator
  action.

See [Notifications and Webhooks](docs/OPERATIONS.md#notifications-and-webhooks)
for exact payload, retry, suspension, and browser-delivery behavior.

These controls reduce local operational and secret-handling risks. They do not
alter Steam or game-service policy. In particular, safety caps and recovery
features do not make automated playtime boosting compliant with the current
Steam Subscriber Agreement.
