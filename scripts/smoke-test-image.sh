#!/bin/sh
set -eu

image=${1:?Usage: smoke-test-image.sh IMAGE NAME_PREFIX}
prefix=${2:?Usage: smoke-test-image.sh IMAGE NAME_PREFIX}

default_container=$prefix-default
migration_container=$prefix-migration
fresh_container=$prefix-unraid
failure_container=$prefix-expected-failure
default_volume=$prefix-default-data
fresh_volume=$prefix-unraid-data
guard_volume=$prefix-guard-data
outside_volume=$prefix-outside-data
nest_volume=$prefix-nested-data
invalid_volume=$prefix-invalid-data

cleanup() {
  for container in \
    "$default_container" \
    "$migration_container" \
    "$fresh_container" \
    "$failure_container"
  do
    docker rm -f "$container" >/dev/null 2>&1 || true
  done

  for volume in \
    "$default_volume" \
    "$fresh_volume" \
    "$guard_volume" \
    "$outside_volume" \
    "$nest_volume" \
    "$invalid_volume"
  do
    docker volume rm "$volume" >/dev/null 2>&1 || true
  done
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cleanup

docker run --rm --user 0:0 "$image" sh -c \
  'test "$(id -u):$(id -g)" = "0:0"'

assert_container_fails() {
  container=$1
  expected_message=$2
  shift 2

  docker run -d --name "$container" "$@" >/dev/null
  attempt=1
  while [ "$attempt" -le 8 ]; do
    container_running=$(
      docker inspect "$container" --format '{{.State.Running}}'
    )
    [ "$container_running" = "true" ] || break
    attempt=$((attempt + 1))
    sleep 1
  done

  if [ "$container_running" = "true" ]; then
    docker logs "$container"
    printf '%s\n' "Expected $container to fail, but it remained running." >&2
    return 1
  fi

  failure_output=$(docker logs "$container" 2>&1)
  failure_status=$(
    docker inspect "$container" --format '{{.State.ExitCode}}'
  )
  if [ "$failure_status" != "64" ]; then
    printf '%s\n' "$failure_output" >&2
    printf '%s\n' "Expected exit 64 from $container, received $failure_status." >&2
    return 1
  fi
  case "$failure_output" in
    *"$expected_message"*) ;;
    *)
      printf '%s\n' "$failure_output" >&2
      printf '%s\n' "Expected failure message: $expected_message" >&2
      return 1
      ;;
  esac

  docker rm "$container" >/dev/null
}

assert_unraid_init_fails() {
  expected_message=$1
  shift

  assert_container_fails \
    "$failure_container" \
    "$expected_message" \
    --entrypoint /usr/local/bin/steam-bee-entrypoint \
    --user 0:0 \
    --pids-limit 256 \
    --cap-drop ALL \
    --cap-add CHOWN \
    --cap-add DAC_READ_SEARCH \
    --cap-add SETGID \
    --cap-add SETPCAP \
    --cap-add SETUID \
    --security-opt no-new-privileges=true \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
    "$@" \
    -e PUID=99 \
    -e PGID=100 \
    -e STEAM_BEE_DATA_INIT=true \
    -e SETUP_TOKEN=12345678 \
    "$image" node dist/index.js
}

assert_container_fails \
  "$failure_container" \
  "refusing to start the application as root" \
  --user 0:0 \
  -e PATH=/data \
  "$image"

wait_for_app() {
  container=$1
  attempt=1
  while [ "$attempt" -le 30 ]; do
    if [ "$(docker inspect "$container" --format '{{.State.Running}}')" != "true" ]; then
      docker logs "$container"
      printf '%s\n' "Container $container exited before becoming ready." >&2
      return 1
    fi
    if docker exec "$container" node -e "Promise.all([fetch('http://127.0.0.1:3000/readyz').then(r=>{if(!r.ok)throw new Error('not ready')}),fetch('http://127.0.0.1:3000/').then(async r=>{if(!r.ok||!(await r.text()).includes('SteamBee'))throw new Error('ui unavailable')})]).then(()=>process.exit(0)).catch(()=>process.exit(1))"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  docker logs "$container"
  return 1
}

wait_for_health() {
  container=$1
  attempt=1
  while [ "$attempt" -le 30 ]; do
    if [ "$(docker inspect "$container" --format '{{.State.Running}}')" != "true" ]; then
      docker logs "$container"
      printf '%s\n' "Container $container exited before becoming healthy." >&2
      return 1
    fi

    health_status=$(
      docker inspect "$container" \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}'
    )
    case "$health_status" in
      healthy) return 0 ;;
      missing)
        printf '%s\n' "Container $container has no Docker healthcheck." >&2
        return 1
        ;;
    esac

    attempt=$((attempt + 1))
    sleep 1
  done

  docker inspect "$container" --format '{{json .State.Health}}'
  docker logs "$container"
  printf '%s\n' "Container $container remained $health_status." >&2
  return 1
}

assert_runtime_process() {
  container=$1
  expected_uid=$2
  expected_gid=$3
  expected_home=$4

  docker exec --user "$expected_uid:$expected_gid" -i \
    "$container" node - "$expected_uid" "$expected_gid" "$expected_home" <<'NODE'
const fs = require("node:fs");

const expectedUid = Number(process.argv[2]);
const expectedGid = Number(process.argv[3]);
const expectedHome = process.argv[4];
let runtimePid = null;

for (const entry of fs.readdirSync("/proc")) {
  if (!/^\d+$/.test(entry)) continue;
  try {
    const command = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8");
    if (command === "node\0dist/index.js\0") {
      runtimePid = entry;
      break;
    }
  } catch {}
}

if (!runtimePid) throw new Error("SteamBee Node process was not found.");

const status = fs.readFileSync(`/proc/${runtimePid}/status`, "utf8");
const readField = (name) => {
  const match = new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(status);
  if (!match) throw new Error(`${name} is missing from process status.`);
  return match[1].trim();
};
const assertIds = (name, expected) => {
  const values = readField(name).split(/\s+/).map(Number);
  if (values.some((value) => value !== expected)) {
    throw new Error(`${name} expected ${expected}, received ${values.join(",")}.`);
  }
};

assertIds("Uid", expectedUid);
assertIds("Gid", expectedGid);
const groups = readField("Groups");
if (
  groups !== "" &&
  groups
    .split(/\s+/)
    .map(Number)
    .some((group) => group !== expectedGid)
) {
  throw new Error(`Unexpected supplementary groups: ${groups}.`);
}
for (const name of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) {
  if (!/^0+$/.test(readField(name))) {
    throw new Error(`${name} was not empty: ${readField(name)}.`);
  }
}
if (readField("NoNewPrivs") !== "1") {
  throw new Error("NoNewPrivs is not enabled.");
}

const environment = fs
  .readFileSync(`/proc/${runtimePid}/environ`, "utf8")
  .split("\0");
if (!environment.includes(`HOME=${expectedHome}`)) {
  throw new Error(`Expected HOME=${expectedHome}.`);
}
NODE
}

assert_healthcheck_drop() {
  container=$1
  expected_uid=$2
  expected_gid=$3

  docker exec "$container" /usr/local/bin/steam-bee-entrypoint --healthcheck node -e "const fs=require('node:fs');if(process.getuid()!==$expected_uid||process.getgid()!==$expected_gid)process.exit(1);const status=fs.readFileSync('/proc/self/status','utf8');const groups=/^Groups:[ \\t]*(.*)$/m.exec(status);if(!groups||groups[1].trim().split(/\\s+/).filter(Boolean).map(Number).some(group=>group!==$expected_gid))process.exit(1);for(const name of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']){if(!new RegExp('^'+name+':[ \\t]+0+$','m').test(status))process.exit(1)}if(!/^NoNewPrivs:[ \\t]+1$/m.test(status))process.exit(1)"
}

docker volume create "$default_volume" >/dev/null
docker run -d \
  --name "$default_container" \
  --init \
  --user 10001:10001 \
  --pids-limit 256 \
  --cap-drop ALL \
  --security-opt no-new-privileges=true \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --health-interval 1s \
  --health-timeout 5s \
  --health-start-period 0s \
  --health-retries 3 \
  -v "$default_volume:/data" \
  -e SETUP_TOKEN=12345678 \
  "$image" >/dev/null

wait_for_app "$default_container"
wait_for_health "$default_container"
assert_runtime_process "$default_container" 10001 10001 /home/steambee
docker exec "$default_container" sh -c \
  'test "$(stat -c "%u:%g:%a" /data)" = "10001:10001:700" && test "$(stat -c "%u:%g:%a" /data/steam-data)" = "10001:10001:700" && test "$(stat -c "%u:%g:%a" /data/instance.secret)" = "10001:10001:600"'
docker exec "$default_container" sh -c \
  'printf migration-ok > /data/steam-data/migration-sentinel'
secret_hash=$(docker exec "$default_container" sha256sum /data/instance.secret | awk '{print $1}')
docker stop -t 10 "$default_container" >/dev/null
test "$(docker inspect "$default_container" --format '{{.State.ExitCode}}')" = "0"
docker rm "$default_container" >/dev/null

docker run -d \
  --name "$migration_container" \
  --entrypoint /usr/local/bin/steam-bee-entrypoint \
  --user 0:0 \
  --pids-limit 256 \
  --cap-drop ALL \
  --cap-add CHOWN \
  --cap-add DAC_READ_SEARCH \
  --cap-add SETGID \
  --cap-add SETPCAP \
  --cap-add SETUID \
  --security-opt no-new-privileges=true \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --health-interval 1s \
  --health-timeout 5s \
  --health-start-period 0s \
  --health-retries 3 \
  -v "$default_volume:/data" \
  -e PUID=99 \
  -e PGID=100 \
  -e STEAM_BEE_DATA_INIT=true \
  -e SETUP_TOKEN=12345678 \
  "$image" node dist/index.js >/dev/null

wait_for_app "$migration_container"
wait_for_health "$migration_container"
assert_runtime_process "$migration_container" 99 100 /data
assert_healthcheck_drop "$migration_container" 99 100
test "$(docker exec "$migration_container" sha256sum /data/instance.secret | awk '{print $1}')" = "$secret_hash"
test "$(docker exec "$migration_container" cat /data/steam-data/migration-sentinel)" = "migration-ok"
docker exec "$migration_container" sh -c \
  'test -z "$(find /data -xdev \( ! -uid 99 -o ! -gid 100 \) -print -quit)" && test "$(stat -c "%a" /data)" = "700" && test "$(stat -c "%a" /data/instance.secret)" = "600" && test "$(stat -c "%u:%g:%a" /data/.steam-bee-data-v1)" = "99:100:700"'
marker_inode=$(
  docker exec "$migration_container" stat -c '%d:%i' /data/.steam-bee-data-v1
)
docker restart "$migration_container" >/dev/null
wait_for_app "$migration_container"
wait_for_health "$migration_container"
assert_runtime_process "$migration_container" 99 100 /data
test "$(docker exec "$migration_container" stat -c '%d:%i' /data/.steam-bee-data-v1)" = "$marker_inode"
docker stop -t 10 "$migration_container" >/dev/null
test "$(docker inspect "$migration_container" --format '{{.State.ExitCode}}')" = "0"
docker rm "$migration_container" >/dev/null

docker volume create "$fresh_volume" >/dev/null
docker run --rm \
  --user 0:0 \
  --entrypoint sh \
  -v "$fresh_volume:/data" \
  "$image" \
  -c 'test -z "$(find /data -mindepth 1 -print -quit)" && chown 0:0 /data && chmod 0755 /data' >/dev/null

docker run -d \
  --name "$fresh_container" \
  --entrypoint /usr/local/bin/steam-bee-entrypoint \
  --user 0:0 \
  --pids-limit 256 \
  --cap-drop ALL \
  --cap-add CHOWN \
  --cap-add DAC_READ_SEARCH \
  --cap-add SETGID \
  --cap-add SETPCAP \
  --cap-add SETUID \
  --security-opt no-new-privileges=true \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --health-interval 1s \
  --health-timeout 5s \
  --health-start-period 0s \
  --health-retries 3 \
  -v "$fresh_volume:/data" \
  -e PUID=99 \
  -e PGID=100 \
  -e STEAM_BEE_DATA_INIT=true \
  -e SETUP_TOKEN=12345678 \
  "$image" node dist/index.js >/dev/null

wait_for_app "$fresh_container"
wait_for_health "$fresh_container"
assert_runtime_process "$fresh_container" 99 100 /data
assert_healthcheck_drop "$fresh_container" 99 100
docker exec "$fresh_container" sh -c \
  'test "$(stat -c "%u:%g:%a" /data)" = "99:100:700" && test "$(stat -c "%u:%g:%a" /data/.steam-bee-data-v1)" = "99:100:700" && test "$(stat -c "%u:%g:%a" /data/instance.secret)" = "99:100:600"'
docker stop -t 10 "$fresh_container" >/dev/null
test "$(docker inspect "$fresh_container" --format '{{.State.ExitCode}}')" = "0"
docker rm "$fresh_container" >/dev/null

docker volume create "$invalid_volume" >/dev/null
docker run --rm --user 0:0 --entrypoint sh -v "$invalid_volume:/data" "$image" \
  -c 'touch /data/untouched && chown -R 0:0 /data' >/dev/null
assert_container_fails \
  "$failure_container" \
  "PUID must be a decimal integer" \
  --entrypoint /usr/local/bin/steam-bee-entrypoint \
  --user 0:0 \
  --cap-drop ALL \
  --cap-add CHOWN \
  --cap-add DAC_READ_SEARCH \
  --cap-add SETGID \
  --cap-add SETPCAP \
  --cap-add SETUID \
  --security-opt no-new-privileges=true \
  -v "$invalid_volume:/data" \
  -e PUID=4294967295 \
  -e PGID=100 \
  -e STEAM_BEE_DATA_INIT=true \
  "$image" node dist/index.js
docker run --rm --user 0:0 --entrypoint sh -v "$invalid_volume:/data" "$image" \
  -c 'test "$(stat -c "%u:%g" /data/untouched)" = "0:0"'

docker volume create "$guard_volume" >/dev/null
docker run --rm --user 0:0 --entrypoint sh -v "$guard_volume:/data" "$image" \
  -c 'mkdir -p /data/plex && touch /data/plex/sentinel && chown -R 0:0 /data' >/dev/null
assert_unraid_init_fails \
  "not an empty or recognized SteamBee data directory" \
  -v "$guard_volume:/data"
docker run --rm --user 0:0 --entrypoint sh -v "$guard_volume:/data" "$image" \
  -c 'test "$(stat -c "%u:%g" /data)" = "0:0" && test "$(stat -c "%u:%g" /data/plex/sentinel)" = "0:0"'

docker volume create "$outside_volume" >/dev/null
docker run --rm \
  --user 0:0 \
  --entrypoint sh \
  -v "$guard_volume:/data" \
  -v "$outside_volume:/outside" \
  "$image" \
  -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; mkdir -p /data/.steam-bee-data-v1 /data/steam-data; touch /outside/sentinel; ln -s /outside/sentinel /data/steam-data/outside-link; chown -R 0:0 /data /outside' >/dev/null
assert_unraid_init_fails \
  "contains a symlink or special file" \
  -v "$guard_volume:/data" \
  -v "$outside_volume:/outside"
docker run --rm \
  --user 0:0 \
  --entrypoint sh \
  -v "$guard_volume:/data" \
  -v "$outside_volume:/outside" \
  "$image" \
  -c 'test "$(stat -c "%u:%g" /data)" = "0:0" && test "$(stat -c "%u:%g" /outside/sentinel)" = "0:0"'

docker run --rm --user 0:0 --entrypoint sh -v "$guard_volume:/fixture" "$image" \
  -c 'find /fixture -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; mkdir -p /fixture/data/.steam-bee-data-v1 /fixture/data/steam-data /fixture/outside; touch /fixture/outside/sentinel; ln /fixture/outside/sentinel /fixture/data/steam-data/shared; chown -R 0:0 /fixture' >/dev/null
assert_unraid_init_fails \
  "contains a hardlinked file" \
  --mount "type=volume,src=$guard_volume,dst=/data,volume-subpath=data"
docker run --rm --user 0:0 --entrypoint sh -v "$guard_volume:/fixture" "$image" \
  -c 'test "$(stat -c "%u:%g:%h" /fixture/data/steam-data/shared)" = "0:0:2" && test "$(stat -c "%u:%g:%h" /fixture/outside/sentinel)" = "0:0:2"'

docker volume create "$nest_volume" >/dev/null
docker run --rm --user 0:0 --entrypoint sh -v "$guard_volume:/data" "$image" \
  -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; mkdir -p /data/.steam-bee-data-v1 /data/steam-data/nested; chown -R 0:0 /data' >/dev/null
docker run --rm --user 0:0 --entrypoint sh -v "$nest_volume:/nested" "$image" \
  -c 'touch /nested/sentinel && chown -R 0:0 /nested' >/dev/null
assert_unraid_init_fails \
  "one dedicated mount without nested mounts" \
  -v "$guard_volume:/data" \
  -v "$nest_volume:/data/steam-data/nested"
docker run --rm --user 0:0 --entrypoint sh -v "$nest_volume:/nested" "$image" \
  -c 'test "$(stat -c "%u:%g" /nested/sentinel)" = "0:0"'
