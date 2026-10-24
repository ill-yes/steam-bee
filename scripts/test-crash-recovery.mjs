import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureDockerOomEvents } from "./docker-oom-events.mjs";

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

async function docker(args, { allowFailure = false, ...options } = {}) {
  const result = await new Promise((resolve) => {
    execFile(
      "docker",
      args,
      {
        encoding: "utf8",
        timeout: 30_000,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
        ...options,
      },
      (error, stdout, stderr) =>
        resolve({
          status: error ? (error.code ?? error.signal ?? 1) : 0,
          stdout,
          stderr,
        }),
    );
  });
  if (!allowFailure) {
    assert.equal(
      result.status,
      0,
      `docker ${args[0]} failed: ${result.stderr}`,
    );
  }
  return result;
}

async function state(name) {
  return JSON.parse(
    (
      await docker([
        "inspect",
        "--format",
        '{"state":{{json .State}},"restarts":{{.RestartCount}}}',
        name,
      ])
    ).stdout,
  );
}

async function owns(kind, name) {
  const args = kind === "volume" ? ["volume", "inspect"] : ["inspect"];
  const field = kind === "volume" ? ".Labels" : ".Config.Labels";
  const result = await docker(
    [...args, "--format", `{{index ${field} "steam-bee.crash-test"}}`, name],
    { allowFailure: true },
  );
  return result.status === 0 && result.stdout.trim() === prefix;
}

async function exec(name, uid, source) {
  return docker(["exec", "--user", uid, name, "node", "-e", source], {
    allowFailure: true,
  });
}

async function ready(name, uid, previous) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const snapshot = await state(name);
    const restarted =
      !previous ||
      (snapshot.restarts > previous.restarts &&
        snapshot.state.StartedAt !== previous.state.StartedAt &&
        snapshot.state.Pid > 0 &&
        snapshot.state.Pid !== previous.state.Pid);
    if (snapshot.state.Running && restarted) {
      const response = await exec(
        name,
        uid,
        `Promise.all([fetch('http://127.0.0.1:3000/readyz').then(r=>{if(!r.ok)throw Error('not ready')}),fetch('http://127.0.0.1:3000/').then(async r=>{if(!r.ok||!(await r.text()).includes('SteamBee'))throw Error('ui unavailable')})]).catch(()=>process.exitCode=1)`,
      );
      if (response.status === 0) return snapshot;
    }
    await sleep(1_000);
  }
  const snapshot = await state(name);
  throw new Error(
    `Recovery timed out for ${name}: ${JSON.stringify({ status: snapshot.state.Status, restarts: snapshot.restarts, exit: snapshot.state.ExitCode, oom: snapshot.state.OOMKilled })}`,
  );
}

async function runContainer(mode, volume, oom = false) {
  const name = `${prefix}-${mode}${oom ? "-oom" : ""}`;
  const uid = mode === "unraid" ? "99:100" : "10001:10001";
  assert.notEqual(
    (await docker(["inspect", name], { allowFailure: true })).status,
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
  containers.add(name);
  const result = await docker(args);
  return { name, uid, id: result.stdout.trim() };
}

async function volume(name) {
  assert.notEqual(
    (await docker(["volume", "inspect", name], { allowFailure: true })).status,
    0,
    "Refusing an existing volume name",
  );
  volumes.add(name);
  await docker(["volume", "create", "--label", label, name]);
  return name;
}

// Linux protects namespace PID 1 from an external same-namespace SIGKILL.
// In that mode the test preload triggers an uncaught error in the actual app.
const killRuntime = `const fs=require('node:fs');const pids=fs.readdirSync('/proc').filter(p=>/^\\d+$/.test(p)).filter(p=>{try{return fs.readFileSync('/proc/'+p+'/cmdline','utf8')==='node\\0dist/index.js\\0'}catch{return false}});if(pids.length!==1)throw Error('Expected one application process');const pid=Number(pids[0]);process.stdout.write(pid===1?'uncaught-error':'SIGKILL');if(pid===1)fs.writeFileSync('/tmp/trigger-crash','synthetic');else process.kill(pid,'SIGKILL');`;

// Only inspect fixed synthetic fixture paths and cgroup counters. Application
// logs, configuration, environment and data are deliberately excluded.
const oomDiagnostics = `const fs=require('node:fs');const counters={};for(const file of ['/sys/fs/cgroup/memory.events','/sys/fs/cgroup/memory.events.local','/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory/memory.failcnt','/sys/fs/cgroup/memory/memory.oom_control','/sys/fs/cgroup/memory/memory.usage_in_bytes','/sys/fs/cgroup/memory/memory.limit_in_bytes']){try{counters[file]=fs.readFileSync(file,'utf8').slice(0,2048)}catch{}}process.stdout.write(JSON.stringify({triggerPending:fs.existsSync('/tmp/trigger-oom'),counters}))`;

async function reportOomFailure(mode, oom, capture, initialCounters) {
  const diagnostics = {
    mode,
    containerId: oom.id,
    initialCounters: initialCounters && {
      status: initialCounters.status,
      stdout: initialCounters.stdout.slice(0, 8_192),
      stderr: initialCounters.stderr.slice(0, 2_048),
    },
  };
  diagnostics.capture = capture?.diagnostics();
  try {
    const snapshot = await state(oom.id);
    diagnostics.container = {
      status: snapshot.state.Status,
      running: snapshot.state.Running,
      exitCode: snapshot.state.ExitCode,
      oomKilled: snapshot.state.OOMKilled,
      startedAt: snapshot.state.StartedAt,
      finishedAt: snapshot.state.FinishedAt,
      restarts: snapshot.restarts,
    };
  } catch (error) {
    diagnostics.inspectError = error.message.slice(0, 2_048);
  }
  const fixture = await exec(oom.id, oom.uid, oomDiagnostics);
  diagnostics.fixture = {
    status: fixture.status,
    stdout: fixture.stdout.slice(0, 8_192),
    stderr: fixture.stderr.slice(0, 2_048),
  };
  console.error(JSON.stringify({ oomFailure: diagnostics }));
}

try {
  for (const mode of ["compose", "unraid"]) {
    const data = await volume(`${prefix}-${mode}-data`);
    const { name, uid } = await runContainer(mode, data);
    let previous = await ready(name, uid);
    const guard = await exec(
      name,
      uid,
      "const fs=require('node:fs');const s=fs.lstatSync('/data/.steam-bee-instance');if(!s.isFile())throw Error('Expected permanent guard');process.stdout.write(String(s.ino))",
    );
    assert.equal(guard.status, 0, "Permanent guard is missing");
    for (let cycle = 1; cycle <= 3; cycle++) {
      const crash = await exec(name, uid, killRuntime);
      assert.match(crash.stdout, /^(SIGKILL|uncaught-error)$/);
      const recovered = await ready(name, uid, previous);
      const nextGuard = await exec(
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
    await docker(["stop", name]);
    const stopped = await state(name);
    assert.equal(stopped.state.ExitCode, 0, "Graceful stop should succeed");
    await docker(["rm", name]);
    containers.delete(name);

    const oom = await runContainer(mode, data, true);
    let capture;
    let initialCounters;
    try {
      const before = await ready(oom.id, oom.uid);
      initialCounters = await exec(oom.id, oom.uid, oomDiagnostics);
      capture = captureDockerOomEvents({
        containerId: oom.id,
        since: new Date(Date.now() - 1_000).toISOString(),
      });
      const marker = `oom-stream-ready-${randomUUID()}`;
      const barrierCommand = await exec(
        oom.id,
        oom.uid,
        `process.stdout.write(${JSON.stringify(marker)})`,
      );
      assert.equal(
        barrierCommand.status,
        0,
        "Could not check event stream readiness",
      );
      const barrier = await capture.waitForBarrier(marker);
      const trigger = await exec(
        oom.id,
        oom.uid,
        "require('node:fs').writeFileSync('/tmp/trigger-oom','synthetic')",
      );
      assert.equal(trigger.status, 0, "Could not trigger isolated OOM fixture");
      const evidence = await capture.waitForOom(barrier.timeNano);
      const after = await ready(oom.id, oom.uid, before);
      const recoveredGuard = await exec(
        oom.id,
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
      console.log(
        JSON.stringify({
          mode,
          oomRecovered: true,
          restarts: after.restarts,
          oomEvent: evidence,
        }),
      );
    } catch (error) {
      await reportOomFailure(mode, oom, capture, initialCounters);
      throw error;
    } finally {
      await capture?.close();
    }
  }
} finally {
  for (const name of containers)
    if (await owns("container", name))
      await docker(["rm", "-f", name], { allowFailure: true });
  for (const name of volumes)
    if (await owns("volume", name))
      await docker(["volume", "rm", name], { allowFailure: true });
}
