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

## Back Up and Restore

The local `backups/` directory is ignored by Git and the Docker build context,
but backup archives still contain sensitive instance data and should be stored
securely outside the repository after creation.

Create a backup while the service is stopped:

```bash
mkdir -m 700 -p backups
docker compose -f compose.image.yml stop steam-bee
docker compose -f compose.image.yml run --rm --no-deps --user 0:0 \
  --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  -v "$PWD/backups:/backup" steam-bee \
  sh -c 'umask 077; tar czf /backup/steam-bee-data-$(date +%Y%m%d-%H%M%S).tgz -C /data .'
docker compose -f compose.image.yml up -d
```

Restore a backup:

```bash
docker compose -f compose.image.yml down
docker compose -f compose.image.yml run --rm --no-deps --user 0:0 \
  --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  -v "$PWD/backups:/backup:ro" steam-bee \
  sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar xzf /backup/<backup-file>.tgz -C /data && chown -R 10001:10001 /data'
docker compose -f compose.image.yml up -d
```

## Updates

Source build:

```bash
git pull
docker compose up --build -d
docker compose logs -f steam-bee
```

Prebuilt image:

If you rely on the pinned default in `compose.image.yml`, run `git pull` to
receive the new release pin. If `.env` sets `STEAM_BEE_IMAGE`, update that value
to the desired version before pulling.

```bash
git pull
docker compose -f compose.image.yml pull
docker compose -f compose.image.yml up -d
docker compose -f compose.image.yml logs -f steam-bee
```

Unraid stores an installed container's template locally and does not overwrite
it with later template revisions. Containers installed before `1.0.5` must be
recreated once from the current Community Apps template, keeping the same
Appdata path. The appdata itself remains persistent, and the new template
adopts it automatically without terminal commands. New installations already
receive the automatic PUID/PGID initialization.
