import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const image = process.argv[2];
assert.ok(image, "Usage: node scripts/test-crash-recovery.mjs IMAGE");
const prefix = `steam-bee-crash-${randomUUID().slice(0, 8)}`;
const fixtureDirectory = fileURLToPath(
  new URL("./fixtures/crash-recovery", import.meta.url),
);
const containers = new Set();
const volumes = new Set();
const label = `steam-bee.crash-test=${prefix}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    ...options,
  });
  if (!options.allowFailure) {
    assert.equal(
      result.status,
      0,
      `docker ${args[0]} failed: ${result.stderr}`,
    );
  }
  return result;
}

function state(name) {
  return JSON.parse(
    docker([
      "inspect",
      "--format",
      '{"state":{{json .State}},"restarts":{{.RestartCount}}}',
      name,
    ]).stdout,
  );
}

function owns(kind, name) {
  const args = kind === "volume" ? ["volume", "inspect"] : ["inspect"];
  const field = kind === "volume" ? ".Labels" : ".Config.Labels";
  const result = docker(
    [...args, "--format", `{{index ${field} "steam-bee.crash-test"}}`, name],
    { allowFailure: true },
  );
  return result.status === 0 && result.stdout.trim() === prefix;
}

function exec(name, uid, source) {
  return docker(["exec", "--user", uid, name, "node", "-e", source], {
    allowFailure: true,
  });
}

async function ready(name, uid, previous) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const snapshot = state(name);
    const restarted =
      !previous ||
      (snapshot.restarts > previous.restarts &&
        snapshot.state.StartedAt !== previous.state.StartedAt &&
        snapshot.state.Pid > 0 &&
        snapshot.state.Pid !== previous.state.Pid);
    if (snapshot.state.Running && restarted) {
      const response = exec(
        name,
        uid,
        `Promise.all([fetch('http://127.0.0.1:3000/readyz').then(r=>{if(!r.ok)throw Error('not ready')}),fetch('http://127.0.0.1:3000/').then(async r=>{if(!r.ok||!(await r.text()).includes('SteamBee'))throw Error('ui unavailable')})]).catch(()=>process.exitCode=1)`,
      );
      if (response.status === 0) return snapshot;
    }
    await sleep(1_000);
  }
  const snapshot = state(name);
  throw new Error(
    `Recovery timed out for ${name}: ${JSON.stringify({ status: snapshot.state.Status, restarts: snapshot.restarts, exit: snapshot.state.ExitCode, oom: snapshot.state.OOMKilled })}`,
  );
}

function runContainer(mode, volume, oom = false) {
  const name = `${prefix}-${mode}${oom ? "-oom" : ""}`;
  const uid = mode === "unraid" ? "99:100" : "10001:10001";
  assert.notEqual(
    docker(["inspect", name], { allowFailure: true }).status,
    0,
    "Refusing an existing container name",
  );
  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--label",
    label,
    "--restart=unless-stopped",
    "--network=none",
    "--pids-limit=128",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    "--stop-timeout=30",
    "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m",
    "--mount",
    `type=volume,src=${volume},dst=/data`,
    "--mount",
    `type=bind,src=${resolve(fixtureDirectory)},dst=/test-faults,readonly`,
    "-e",
    `NODE_OPTIONS=--require=/test-faults/crash.cjs${oom ? " --require=/test-faults/oom.cjs" : ""}`,
    "-e",
    "SETUP_TOKEN=crash-test-synthetic-token",
  ];
  if (mode === "unraid") {
    args.push(
      "--user=0:0",
      "--entrypoint=/usr/local/bin/steam-bee-entrypoint",
      "--cap-add=CHOWN",
      "--cap-add=DAC_READ_SEARCH",
      "--cap-add=SETGID",
      "--cap-add=SETPCAP",
      "--cap-add=SETUID",
      "-e",
      "PUID=99",
      "-e",
      "PGID=100",
      "-e",
      "STEAM_BEE_DATA_INIT=true",
    );
  } else args.push("--init", `--user=${uid}`);
  if (oom) args.push("--memory=256m", "--memory-swap=256m");
  args.push(image, "node", "dist/index.js");
  docker(args);
  containers.add(name);
  return { name, uid };
}

function volume(name) {
  assert.notEqual(
    docker(["volume", "inspect", name], { allowFailure: true }).status,
    0,
    "Refusing an existing volume name",
  );
  docker(["volume", "create", "--label", label, name]);
  volumes.add(name);
  return name;
}

// Linux protects namespace PID 1 from an external same-namespace SIGKILL.
// In that mode the test preload triggers an uncaught error in the actual app.
const killRuntime = `const fs=require('node:fs');const pids=fs.readdirSync('/proc').filter(p=>/^\\d+$/.test(p)).filter(p=>{try{return fs.readFileSync('/proc/'+p+'/cmdline','utf8')==='node\\0dist/index.js\\0'}catch{return false}});if(pids.length!==1)throw Error('Expected one application process');const pid=Number(pids[0]);process.stdout.write(pid===1?'uncaught-error':'SIGKILL');if(pid===1)fs.writeFileSync('/tmp/trigger-crash','synthetic');else process.kill(pid,'SIGKILL');`;

try {
  for (const mode of ["compose", "unraid"]) {
    const data = volume(`${prefix}-${mode}-data`);
    const { name, uid } = runContainer(mode, data);
    let previous = await ready(name, uid);
    const guard = exec(
      name,
      uid,
      "const fs=require('node:fs');const s=fs.lstatSync('/data/.steam-bee-instance');if(!s.isFile())throw Error('Expected permanent guard');process.stdout.write(String(s.ino))",
    );
    assert.equal(guard.status, 0, "Permanent guard is missing");
    for (let cycle = 1; cycle <= 3; cycle++) {
      const crash = exec(name, uid, killRuntime);
      assert.match(crash.stdout, /^(SIGKILL|uncaught-error)$/);
      const recovered = await ready(name, uid, previous);
      const nextGuard = exec(
        name,
        uid,
        "process.stdout.write(String(require('node:fs').lstatSync('/data/.steam-bee-instance').ino))",
      );
      assert.equal(
        nextGuard.stdout,
        guard.stdout,
        "Guard inode changed during recovery",
      );
      console.log(
        JSON.stringify({
          mode,
          cycle,
          mechanism: crash.stdout,
          recovered: true,
          restarts: recovered.restarts,
        }),
      );
      previous = recovered;
    }
    docker(["stop", name]);
    const stopped = state(name);
    assert.equal(stopped.state.ExitCode, 0, "Graceful stop should succeed");
    docker(["rm", name]);
    containers.delete(name);

    const oom = runContainer(mode, data, true);
    const before = await ready(oom.name, oom.uid);
    const since = Math.floor(Date.now() / 1000);
    const trigger = exec(
      oom.name,
      oom.uid,
      "require('node:fs').writeFileSync('/tmp/trigger-oom','synthetic')",
    );
    assert.equal(trigger.status, 0, "Could not trigger isolated OOM fixture");
    const after = await ready(oom.name, oom.uid, before);
    const recoveredGuard = exec(
      oom.name,
      oom.uid,
      "process.stdout.write(String(require('node:fs').lstatSync('/data/.steam-bee-instance').ino))",
    );
    assert.equal(
      recoveredGuard.status,
      0,
      "Guard is missing after OOM recovery",
    );
    assert.equal(
      recoveredGuard.stdout,
      guard.stdout,
      "Guard inode changed during OOM recovery",
    );
    const events = docker([
      "events",
      "--since",
      String(since),
      "--until",
      String(Math.floor(Date.now() / 1000) + 1),
      "--filter",
      `container=${oom.name}`,
      "--filter",
      "event=oom",
      "--format",
      "{{.Action}}",
    ]);
    assert.match(
      events.stdout,
      /\boom\b/,
      "Expected Docker OOM evidence, not just a process restart",
    );
    console.log(
      JSON.stringify({ mode, oomRecovered: true, restarts: after.restarts }),
    );
  }
} finally {
  for (const name of containers)
    if (owns("container", name))
      docker(["rm", "-f", name], { allowFailure: true });
  for (const name of volumes)
    if (owns("volume", name))
      docker(["volume", "rm", name], { allowFailure: true });
}
