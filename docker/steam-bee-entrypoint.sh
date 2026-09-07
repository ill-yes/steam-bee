#!/bin/sh
set -eu

upstream_entrypoint=/usr/local/bin/docker-entrypoint.sh
max_runtime_id=2147483647
data_marker=/data/.steam-bee-data-v1
current_uid=$(/usr/bin/id -u)

if [ "$current_uid" -eq 0 ]; then
  # Never resolve privileged initialization tools through a user-controlled PATH.
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  export PATH
fi

fail() {
  printf 'SteamBee entrypoint: %s\n' "$*" >&2
  exit 64
}

validate_runtime_id() {
  id_name=$1
  id_value=$2

  case "$id_value" in
    "" | 0 | 0* | *[!0-9]*)
      fail "$id_name must be a decimal integer between 1 and $max_runtime_id."
      ;;
  esac

  if ! [ "$id_value" -le "$max_runtime_id" ] 2>/dev/null; then
    fail "$id_name must be a decimal integer between 1 and $max_runtime_id."
  fi
}

load_runtime_ids() {
  runtime_uid=${PUID:-}
  runtime_gid=${PGID:-}
  validate_runtime_id PUID "$runtime_uid"
  validate_runtime_id PGID "$runtime_gid"
}

validate_data_mount() {
  [ -r /proc/self/mountinfo ] ||
    fail "cannot verify the /data mount boundary."

  awk '
    $5 == "/data" { data_mounts++ }
    index($5, "/data/") == 1 { nested_mount = 1 }
    END { exit !(data_mounts == 1 && nested_mount != 1) }
  ' /proc/self/mountinfo ||
    fail "/data must be one dedicated mount without nested mounts."
}

validate_known_path() {
  path=$1
  expected_type=$2

  case "$expected_type" in
    file)
      [ -f "$path" ] && [ ! -L "$path" ] ||
        fail "the /data layout contains an invalid SteamBee file type."
      ;;
    directory)
      [ -d "$path" ] && [ ! -L "$path" ] ||
        fail "the /data layout contains an invalid SteamBee directory type."
      ;;
  esac
}

validate_lease_directory() {
  lease_path=$1
  validate_known_path "$lease_path" directory
  lease_entry=$(find "$lease_path" -mindepth 1 -maxdepth 1 ! -name owner.json -print -quit) ||
    fail "could not inspect the SteamBee instance lease."
  [ -z "$lease_entry" ] || fail "the SteamBee instance lease is invalid."
  [ ! -e "$lease_path/owner.json" ] || validate_known_path "$lease_path/owner.json" file
}

validate_stale_lease_name() {
  stale_owner=${1#.steam-bee-instance.stale-}
  case "$stale_owner" in
    ????????-????-????-????-????????????) ;;
    *) fail "the SteamBee stale instance lease name is invalid." ;;
  esac
  case "$stale_owner" in
    *[!0123456789abcdef-]*)
      fail "the SteamBee stale instance lease name is invalid."
      ;;
  esac
}

validate_data_layout() {
  has_entries=false
  has_marker=false

  for path in /data/* /data/.[!.]* /data/..?*; do
    if [ ! -e "$path" ] && [ ! -L "$path" ]; then
      continue
    fi

    has_entries=true
    case "${path##*/}" in
      instance.secret | setup.token | steam-bee.sqlite | \
        steam-bee.sqlite-wal | steam-bee.sqlite-shm | \
        steam-bee.sqlite-journal)
        validate_known_path "$path" file
        ;;
      steam-data)
        validate_known_path "$path" directory
        ;;
      .steam-bee-instance)
        if [ -d "$path" ]; then
          validate_lease_directory "$path"
        else
          validate_known_path "$path" file
        fi
        ;;
      .steam-bee-instance-journal)
        validate_known_path "$path" file
        validate_known_path /data/.steam-bee-instance file
        ;;
      .steam-bee-instance.stale-*)
        validate_stale_lease_name "${path##*/}"
        validate_lease_directory "$path"
        ;;
      .steam-bee-restore-staging | .steam-bee-restore-rollback)
        validate_known_path "$path" directory
        restore_unsafe=$(find "$path" -mindepth 1 -maxdepth 1 \
          ! -name instance.secret \
          ! -name steam-bee.sqlite \
          ! -name steam-bee.sqlite-wal \
          ! -name steam-bee.sqlite-shm \
          ! -name steam-bee.sqlite-journal \
          -print -quit) || fail "could not inspect SteamBee restore data."
        [ -z "$restore_unsafe" ] || fail "the SteamBee restore data is invalid."
        ;;
      .steam-bee-data-v1)
        validate_known_path "$path" directory
        marker_entry=$(find "$path" -mindepth 1 -maxdepth 1 -print -quit) ||
          fail "could not inspect the SteamBee data marker."
        [ -z "$marker_entry" ] || fail "the SteamBee data marker is invalid."
        has_marker=true
        ;;
      *)
        fail "refusing ownership changes: /data is not an empty or recognized SteamBee data directory."
        ;;
    esac
  done

  if [ "$has_entries" = "false" ] || [ "$has_marker" = "true" ]; then
    return
  fi

  [ -d /data/steam-data ] &&
    [ -f /data/instance.secret ] &&
    [ -f /data/steam-bee.sqlite ] ||
    fail "refusing ownership changes: unmarked /data is not recognizable SteamBee data."
}

validate_data_tree() {
  unsafe_path=$(
    find /data -xdev -mindepth 1 ! -type d ! -type f -print -quit
  ) || fail "could not inspect the SteamBee data tree."
  [ -z "$unsafe_path" ] ||
    fail "refusing ownership changes: /data contains a symlink or special file."

  hardlinked_path=$(
    find /data -xdev -type f -links +1 -print -quit
  ) || fail "could not inspect SteamBee file links."
  [ -z "$hardlinked_path" ] ||
    fail "refusing ownership changes: /data contains a hardlinked file."
}

validate_guarded_ownership() {
  mismatched_owner=$(
    find /data -xdev \( ! -uid "$runtime_uid" -o ! -gid "$runtime_gid" \) -print -quit
  ) || fail "could not verify ownership of the guarded SteamBee data tree."
  [ -z "$mismatched_owner" ] ||
    fail "an instance guard exists and /data ownership does not match PUID/PGID; stop all instances and perform an explicit offline ownership migration."
}

require_no_instance_guard() {
  [ ! -e /data/.steam-bee-instance ] && [ ! -L /data/.steam-bee-instance ] ||
    fail "an instance guard appeared during initialization; stop all instances and inspect /data before retrying."
}

migrate_data_ownership() {
  require_no_instance_guard
  chown --no-dereference "$runtime_uid:$runtime_gid" -- /data

  for path in \
    /data/instance.secret \
    /data/setup.token \
    /data/steam-bee.sqlite \
    /data/steam-bee.sqlite-wal \
    /data/steam-bee.sqlite-shm \
    /data/steam-bee.sqlite-journal \
    /data/.steam-bee-instance \
    /data/.steam-bee-instance-journal \
    "$data_marker"
  do
    [ -e "$path" ] || continue
    require_no_instance_guard
    chown --no-dereference "$runtime_uid:$runtime_gid" -- "$path"
  done

  if [ -d /data/steam-data ]; then
    require_no_instance_guard
    find /data/steam-data -xdev \
      \( -type d -o -type f \) \
      \( ! -uid "$runtime_uid" -o ! -gid "$runtime_gid" \) \
      -exec chown --no-dereference "$runtime_uid:$runtime_gid" -- {} +
  fi

  for lease_dir in /data/.steam-bee-instance /data/.steam-bee-instance.stale-*; do
    [ -d "$lease_dir" ] || continue
    require_no_instance_guard
    find "$lease_dir" -xdev \
      \( -type d -o -type f \) \
      \( ! -uid "$runtime_uid" -o ! -gid "$runtime_gid" \) \
      -exec chown --no-dereference "$runtime_uid:$runtime_gid" -- {} +
  done

  for restore_dir in /data/.steam-bee-restore-staging /data/.steam-bee-restore-rollback; do
    [ -d "$restore_dir" ] || continue
    require_no_instance_guard
    find "$restore_dir" -xdev \
      \( -type d -o -type f \) \
      \( ! -uid "$runtime_uid" -o ! -gid "$runtime_gid" \) \
      -exec chown --no-dereference "$runtime_uid:$runtime_gid" -- {} +
  done
}

create_data_marker() {
  [ -d "$data_marker" ] && return
  require_no_instance_guard

  # $1 is expanded by the unprivileged child shell, not this entrypoint.
  # shellcheck disable=SC2016
  setpriv \
    --reuid "$runtime_uid" \
    --regid "$runtime_gid" \
    --clear-groups \
    --bounding-set=-all \
    --inh-caps=-all \
    --ambient-caps=-all \
    --no-new-privs \
    -- sh -eu -c 'umask 077; mkdir -- "$1"' sh "$data_marker" ||
    fail "could not create the SteamBee data marker."
}

exec_as_runtime_user() {
  export HOME=/data
  export USER=steambee
  export LOGNAME=steambee

  exec setpriv \
    --reuid "$runtime_uid" \
    --regid "$runtime_gid" \
    --clear-groups \
    --bounding-set=-all \
    --inh-caps=-all \
    --ambient-caps=-all \
    --no-new-privs \
    -- "$@"
}

if [ "${1:-}" = "--healthcheck" ]; then
  shift
  [ "$#" -gt 0 ] || fail "the healthcheck command is missing."

  if [ "$current_uid" -eq 0 ]; then
    load_runtime_ids
    exec_as_runtime_user "$@"
  fi

  exec "$@"
fi

if [ "$current_uid" -eq 0 ]; then
  if [ "${STEAM_BEE_DATA_INIT:-false}" != "true" ]; then
    if [ "${1:-}" = "node" ] && [ "${2:-}" = "dist/index.js" ]; then
      fail "refusing to start the application as root without STEAM_BEE_DATA_INIT=true."
    fi

    exec "$upstream_entrypoint" "$@"
  fi

  load_runtime_ids
  [ "${DATA_DIR:-/data}" = "/data" ] ||
    fail "automatic ownership initialization supports only DATA_DIR=/data."
  [ -d /data ] && [ ! -L /data ] || fail "/data must be a directory."

  validate_data_mount
  validate_data_layout
  validate_data_tree

  if [ -e /data/.steam-bee-instance ]; then
    [ ! -d /data/.steam-bee-instance ] ||
      fail "a legacy instance lease exists; stop all instances and follow the offline guard migration procedure."
    validate_guarded_ownership
    # A live SQLite owner may hold this permanent inode. Even a same-ID chown
    # or marker write belongs after acquisition, never in root initialization.
    exec_as_runtime_user "$upstream_entrypoint" "$@"
  fi

  printf 'SteamBee: preparing /data for PUID=%s PGID=%s\n' \
    "$runtime_uid" "$runtime_gid"

  migrate_data_ownership
  create_data_marker

  exec_as_runtime_user "$upstream_entrypoint" "$@"
fi

if [ "${STEAM_BEE_DATA_INIT:-false}" = "true" ]; then
  load_runtime_ids
  [ "$current_uid" -eq "$runtime_uid" ] &&
    [ "$(/usr/bin/id -g)" -eq "$runtime_gid" ] ||
    fail "STEAM_BEE_DATA_INIT=true requires root startup or matching PUID/PGID."
fi

exec "$upstream_entrypoint" "$@"
