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

SteamBee acquires an exclusive SQLite lock on `/data/.steam-bee-instance`
before opening the application database. This is a permanent file, not the
temporary lease directory used by older versions. A second process using the
same data directory exits instead of starting duplicate Steam workers. The
operating system releases the lock when the owner exits, including after a
crash, SIGKILL, or OOM; a configured Docker restart policy can then restart
SteamBee on the same data. A paused process retains its lock. Heartbeat age and
PID numbers never authorize a takeover.

Do not delete, rename, replace, or open the guard file with another connection
inside the running application. Its optional `.steam-bee-instance-journal`
belongs to SQLite recovery and must also be preserved. The runtime guard is
not part of portable `.sbb` backups. Diagnostics distinguish a busy
owner, a legacy lease, and a retained restore fence; repeated restart attempts
do not resolve a restore fence or an old lease directory.

This requires reliable local SQLite file locking. Docker named volumes and
local appdata mounts are the intended deployment targets. NFS/SMB storage and
mount aliases or mover setups that replace active files are not supported
without an explicit locking validation. On Unraid, validate the actual appdata
mount before relying on automatic crash recovery; a Docker Desktop or CI test
does not establish the host filesystem's guarantees.

### Recovering a legacy lease after an unclean stop

A remaining `.steam-bee-instance` **directory** is deliberately not converted
or removed automatically. Use this one-time operator procedure before the
first upgraded start:

1. Identify the exact container, image, `/data` mount source, and every other
   container or host process that can access it. Stop all runtime and restore
   processes, including automatic restart sources, and verify they are stopped.
2. Make a cold backup of the complete dedicated data directory to a separate
   location. Inspect the old lease's owner kind and any restore staging or
   rollback material without exposing tokens or the instance secret.
3. If the owner is a restore, its identity is unknown, or recovery material
   suggests an incomplete restore, stop and inspect the matching database and
   secret before making any change. Never treat lease age as proof of safety.
4. Only after confirming no owner remains, verifying the backup, and obtaining
   explicit approval for the exact path may an operator archive the old lease
   directory outside `/data`. Do not remove the new regular guard file.
5. Start the upgraded container and verify `/readyz`, the web interface, and
   account state. Restore the intended Docker restart policy if it was paused.

The upgraded format intentionally blocks older images. Rollback requires the
matching pre-upgrade backup and application version, not removal of the guard.

The container root filesystem is read-only. Only `/data` and the bounded
`/tmp` tmpfs are writable, and Docker's `json-file` logs rotate by default.

## Concurrent Steam Sessions and Safety Recovery

SteamBee never forces another Steam session off the account. Steam results
`6`, `34`, and `50`, together with the live occupied-account signal, enter one
automatic recovery cycle. The first and second conflicts retry after five
minutes; the third waits for a 60-minute cooldown. Further conflicts begin the
same three-step cycle again without requiring a manual resume. The account's
Recovery health panel shows the current attempt, next retry, or cooldown.

If Steam reports the account free while a retry or cooldown is pending,
SteamBee cancels that timer and resumes immediately. Pause, stop, schedule end,
account deletion, and any other transition away from the running desired state
cancel pending callbacks and clear the visible retry state. A container restart
does not restore an old conflict counter or cooldown: eligible accounts begin a
fresh cycle immediately at attempt 1, after schedules have first been reconciled
so an expired window cannot cause a transient login.

Authentication failures remain terminal and require a new sign-in. Generic
network and rate-limit failures retain their separate backoff policy. If a
safety pause fails, its hold remains active while SteamBee attempts both an
empty `gamesPlayed` update and `logOff`. If that fallback cannot be confirmed,
the account receives a persistent attention hold and is not auto-started until
an operator resolves the failure. This safety fallback does not use Steam's
forced session-takeover option.

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
Once the permanent instance guard exists, the helper verifies that the complete
data tree already belongs to the configured PUID/PGID and performs no ownership
or marker writes. A mismatch fails startup without changing data, protecting a
running instance from a second container with different IDs. Changing PUID/PGID
then requires a separately authorized offline ownership migration: identify the
exact appdata mount, stop every application and restore using it, verify a
backup, and preserve the permanent guard file and its inode. Never remove the
guard to permit automatic ownership changes. Legacy lease directories also
fail closed and require the recovery procedure above.

Serialize first-time root initialization and upgrades from a clean legacy
shutdown before a guard file has been established. Never run two
`STEAM_BEE_DATA_INIT=true` initializers against the same unguarded `/data` at
once, especially with different PUID/PGID values. The shell helper checks for
an appearing guard before ownership changes, but these first-provisioning
checks and changes are not atomic. Established guard files use the read-only
ownership-check path described above.

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
- `steam.session.conflict`
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

Webhook delivery is durable. Rule revisions are immutable delivery boundaries:
events older than a new rule's event-ID boundary are not replayed, and a
delivery already in flight keeps its original target and cannot update the
replacement rule's health. A failed delivery is tried at most three times:
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
history or the process list. It holds the same exclusive guard as the server
and durably records a restore fence before changing recovery data. A killed
restore releases its process lock but retains this fence, so neither a server
nor another restore can start over a possibly incomplete installation. Only a
successful restore or fully verified rollback and cleanup clears the fence.
Never delete the guard to bypass it: confirm all owners have stopped, retain a
complete cold backup, and have an operator verify recovery before proceeding. Keep
`.steam-bee-restore-rollback` until login, account state, and diagnostics have
been verified. A later restore refuses to overwrite that rollback directory;
archive or remove it only after verification.

If both snapshot installation and its automatic rollback fail, the command
reports the staging and rollback paths and deliberately retains
the permanent guard and its restore fence, `.steam-bee-restore-staging`, and
`.steam-bee-restore-rollback`. Do not start SteamBee or remove any of them.
Copy the complete data directory first, then repair the reported files or
recover from the original `.sbb` with an operator who can verify the SQLite
snapshot and matching instance secret.

### Process crashes and Steam credentials

The Steam lifecycle patch ignores connection work that finishes after a
disconnect and safely retains an admitted successful token renewal where its
predecessor is still current. Graceful shutdown admits no new Steam work and
allows at most 25 seconds for cleanup, within Docker's 30-second stop window.
An unrecoverable cleanup failure exits with a nonzero status rather than
continuing with uncertain ownership.

Automatic service recovery does not guarantee uninterrupted Steam credentials:
Steam may invalidate the previous token just before an abrupt process death
prevents storing its replacement. In that narrow window, the service restarts
but the account can require a new login. Terminal authentication errors become
`login_required`; they are not retried indefinitely. Account pause/stop intent
and the existing session-conflict retry timing remain unchanged.

Container validation uses synthetic accounts only. The crash recovery test
performs three unexpected application-process crashes and a cgroup OOM in both
Compose-init and Unraid-style modes, checking automatic restart, readiness,
the web interface, and an unchanged guard inode on the same volume. It does
not use a manual `docker restart` as proof of automatic recovery. Compose-init
uses SIGKILL against the actual Node process. For the Unraid-style namespace
PID 1, which Linux protects from an external same-namespace SIGKILL, a test-only
preload triggers an uncaught error inside that Node process. The isolated OOM
test additionally requires a Docker OOM event, not just an increased restart
counter. Test preloads are bind-mounted only into the disposable test containers
and are not part of the production image.

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
