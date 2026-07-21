# Operations and Data

This guide covers day-to-day SteamBee operation, persistent storage, backups,
restores, and updates. For source builds, image versions, environment settings,
or reverse-proxy configuration, see
[Deployment and Configuration](DEPLOYMENT.md).

Unless explicitly labeled as a source build, the examples use the recommended
prebuilt-image Compose file. If you built from source, omit
`-f compose.image.yml`.

Run all commands from the repository root.

## Runtime Commands

```bash
docker compose -f compose.image.yml ps
docker compose -f compose.image.yml logs -f steam-bee
curl -fsS http://127.0.0.1:3000/readyz
docker compose -f compose.image.yml down
```

## Persistent Data

Compose mounts `/data` as the named volume `steam-bee-data`. It contains SQLite
state, the instance encryption secret, encrypted Steam refresh tokens, and
Steam client data. Do not bind this to the repository unless you know exactly
what you are doing.

SteamBee acquires `/data/.steam-bee-instance` before opening the application
database. A second process using the same data directory exits instead of
starting duplicate Steam workers. SteamBee deliberately does not auto-take-over
an expired heartbeat because a suspended old process could resume and create
split brain. After an unclean stop, confirm no server or restore process still
uses the directory before removing the exact `.steam-bee-instance` lease and
restarting.

The container root filesystem is read-only. Only `/data` and the bounded
`/tmp` tmpfs are writable, and Docker's `json-file` logs rotate by default.

Named volumes are the supported default. On Unraid, you can replace the volume
with an appdata bind mount if you want direct host-side backups:

```yaml
volumes:
  - /mnt/user/appdata/steambee:/data
```

The standard image and both Compose files run as UID/GID `10001`. Make sure
custom bind mounts are writable by that user, and never point `/data` at the
checked-out repository.

The official Unraid template uses Unraid's conventional `PUID=99` and
`PGID=100`. Its restricted startup helper changes ownership only inside
`/data`, clears every inherited, permitted, effective, bounding, and ambient
capability, and then replaces itself with the Node process as that unprivileged
user. New Unraid installations therefore require no host-side `chown` command.
Changing PUID or PGID in the template automatically migrates existing appdata
ownership on the next start.

Keep the template's Appdata mapping pointed at one dedicated SteamBee directory
(the default is `/mnt/user/appdata/steambee`). Before changing any ownership,
the helper requires an empty, previously marked, or recognizable SteamBee data
directory and rejects unexpected top-level entries, hardlinks, symlinks,
special files, and nested mounts. This prevents an accidentally broad mapping
such as `/mnt/user/appdata` from rewriting other containers' data.

## Notifications and Webhooks

Notification rules are managed in **Admin area → Operations**. The default
rule subscribes to five operational selectors:

- `steam.status.login_required`
- `steam.status.paused_other_session`
- `steam.schedule.error`
- `steam.safety.cap`
- `steam.status.error`

Browser alerts use the browser Notification API and the page's authenticated
SSE connection. They are local to the browser profile that granted permission;
they are not Web Push. At least one authenticated SteamBee page must be open at
the time of the event, and past events are not replayed as browser alerts after
the page reconnects. Enabling browser alerts again updates the existing browser
rule instead of creating another default rule.

Webhook rules send an HTTP `POST` with `content-type: application/json` and
this exact redacted shape:

```json
{
  "source": "SteamBee",
  "type": "event",
  "eventId": "<local event id>",
  "eventType": "steam.status.error",
  "createdAt": 1770000000000
}
```

Account IDs, account names, event messages, refresh tokens, and the webhook URL
are not included. Targets must use public HTTP or HTTPS without URL
credentials. Redirects are not followed; DNS results resolving to loopback,
private, link-local, multicast, or reserved address space are rejected. Each
request has an 8-second timeout, and a response body above 64 KiB fails the
delivery.

Webhook delivery is durable. A failed delivery is tried at most three times:
immediately, then after approximately 30 and 60 seconds. Five consecutive
delivery failures suspend the rule for one hour. The Operations tab shows
whether a rule is active, retrying, failed, suspended, or disabled, together
with its failure count and next retry or suspension time. On restart SteamBee
reconciles matching events created since the rule was created; a database
uniqueness constraint prevents the same rule/event pair from being queued
twice.

## Back Up and Restore

The Admin area's **Operations** tab creates a passphrase-encrypted recovery
backup without stopping SteamBee. It uses SQLite's online backup API and
contains exactly:

- a consistent `steam-bee.sqlite` snapshot
- the matching `instance.secret` required to decrypt stored refresh tokens

The portable recovery backup intentionally excludes replaceable Steam client
caches under `steam-data`. Store the `.sbb` file and its passphrase separately.
There is no passphrase recovery, and neither the passphrase nor webhook targets
are written to logs.

Restore is intentionally unavailable in the running web process. The offline
tool decrypts into a staging directory, validates entry allowlists and
checksums, validates the instance key, runs SQLite `integrity_check`, rejects a
newer migration version, and moves existing critical files into
`.steam-bee-restore-rollback` before installing the snapshot.

Keep the original `.sbb` file in a local private directory. The standard image
runs as UID/GID `10001`, so stage a separate read-only copy owned by that exact
identity; a host directory owned by your login with mode `0700` is intentionally
not readable inside the container. If Compose uses a different `user`, substitute
that UID/GID below. Then stop the stack and run:

```bash
mkdir -m 700 -p backups
sudo install -d -o 10001 -g 10001 -m 0700 backups/restore-stage
sudo install -o 10001 -g 10001 -m 0400 \
  backups/<backup-file>.sbb backups/restore-stage/restore.sbb
docker compose -f compose.image.yml down
docker compose -f compose.image.yml run --rm --no-deps -i \
  -v "$PWD/backups/restore-stage:/backup:ro" steam-bee \
  node dist/restore.js --input /backup/restore.sbb --data-dir /data
docker compose -f compose.image.yml up -d
curl -fsS http://127.0.0.1:3000/readyz
sudo rm -- backups/restore-stage/restore.sbb
sudo rmdir -- backups/restore-stage
```

The restore command prompts for the passphrase without placing it in command
history or the process list. It atomically holds the same `/data` lease as the
server for the complete decrypt, validation, install, or rollback sequence. An
unexpectedly killed restore intentionally leaves `.steam-bee-instance` in
place so a server cannot start over a possibly incomplete restore. After
confirming that neither a server nor restore process is running, inspect and
remove that exact lease directory before retrying. Keep
`.steam-bee-restore-rollback` until login, account state, and diagnostics have
been verified. A later restore refuses to overwrite that rollback directory;
archive or remove it only after verification.

If both snapshot installation and its automatic rollback fail, the command
reports the staging and rollback paths and deliberately retains all three of
`.steam-bee-instance`, `.steam-bee-restore-staging`, and
`.steam-bee-restore-rollback`. Do not start SteamBee or remove any of them.
Copy the complete data directory first, then repair the reported files or
recover from the original `.sbb` with an operator who can verify the SQLite
snapshot and matching instance secret.

### Cold full-volume snapshot

An infrastructure-level volume snapshot is still appropriate when exact Steam
client cache continuity matters. Create it only while the service is stopped.

```bash
mkdir -m 700 -p backups
docker compose -f compose.image.yml stop steam-bee
docker compose -f compose.image.yml run --rm --no-deps --user 0:0 \
  --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  -v "$PWD/backups:/backup" steam-bee \
  sh -c 'umask 077; tar czf /backup/steam-bee-data-$(date +%Y%m%d-%H%M%S).tgz -C /data .'
docker compose -f compose.image.yml up -d
```

Restore a cold full-volume snapshot with the storage provider's offline volume
restore mechanism. Do not unpack it over a running instance or mix it with the
portable `.sbb` restore flow.

## Updates

Before every upgrade, create and retain a verified recovery backup from
**Admin area → Operations** (or a cold full-volume snapshot). Keep the backup
and passphrase outside the source checkout and do not proceed until both are
available.

Source build:

```bash
git pull
docker compose up --build -d
docker compose logs -f steam-bee
```

Prebuilt image:

If you rely on the mutable `latest` channel in `compose.image.yml`, run
`git pull` before pulling the image. If `.env` sets `STEAM_BEE_IMAGE`, update
that value to the desired exact version before pulling.

```bash
git pull
docker compose -f compose.image.yml pull
docker compose -f compose.image.yml up -d
docker compose -f compose.image.yml logs -f steam-bee
```

Current SteamBee versions refuse to start when the database contains a migration
they do not recognize. This protection is not retroactive: a previously released
image may not recognize that it is older and must never be started against an
upgraded `/data` directory. To roll back, restore a verified pre-upgrade backup
with its matching application version first; do not delete rows from
`app_migration` to force an older image to start.

Unraid stores an installed container's template locally and does not overwrite
it with later template revisions. Containers installed before `1.0.5` must be
recreated once from the current Community Apps template, keeping the same
Appdata path. The appdata itself remains persistent, and the new template
adopts it automatically without terminal commands. New installations already
receive the automatic PUID/PGID initialization.
