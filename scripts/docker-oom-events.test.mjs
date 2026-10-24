import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { captureDockerOomEvents } from "./docker-oom-events.mjs";

const containerId = "a".repeat(64);
const marker = "oom-stream-ready-test-marker";
const boundary = "1792800000123456789";

function event(action, timeNano = boundary, id = containerId) {
  return `${JSON.stringify({ id, action, timeNano })}\n`;
}

function harness(t, { killCloses = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (killCloses) queueMicrotask(() => child.emit("close", null, signal));
    return true;
  };
  let command;
  const capture = captureDockerOomEvents({
    containerId,
    since: "2026-10-24T00:00:00.000Z",
    closeTimeoutMs: 10,
    spawnProcess: (...args) => {
      command = args;
      return child;
    },
  });
  t.after(() => capture.close().catch(() => {}));
  return { capture, child, signals, command };
}

test("subscribes to the exact container before accepting a unique readiness barrier", async (t) => {
  const { capture, child, command } = harness(t);
  assert.equal(command[0], "docker");
  assert.ok(command[1].includes(`container=${containerId}`));
  assert.equal(command[1].includes("--until"), false);
  const waiting = capture.waitForBarrier(marker, 100);
  const line = event(`exec_create: node -e process.stdout.write('${marker}')`);
  child.stdout.write(line.slice(0, 17));
  child.stdout.write(line.slice(17));
  assert.equal((await waiting).timeNano, boundary);
});

test("preserves nanosecond precision and accepts an OOM buffered during the trigger", async (t) => {
  const { capture, child } = harness(t);
  child.stdout.write(event("oom", "1792800000123456790"));
  const evidence = await capture.waitForOom(boundary, 100);
  assert.equal(evidence.timeNano, "1792800000123456790");
});

test("restart, stale OOM and another container's OOM cannot satisfy evidence", async (t) => {
  const { capture, child } = harness(t);
  child.stdout.write(event("oom", "1792800000123456788"));
  child.stdout.write(event("oom"));
  child.stdout.write(event("restart", "1792800000123456790"));
  child.stdout.write(event("oom", "1792800000123456791", "b".repeat(64)));
  await assert.rejects(
    capture.waitForOom(boundary, 10),
    /Timed out waiting for Docker OOM evidence, not just a process restart/,
  );
});

test("readiness requires the marker in an exec_create event for this container", async (t) => {
  const { capture, child } = harness(t);
  child.stdout.write(event(`exec_die: ${marker}`));
  child.stdout.write(event("exec_create: node -e other-command"));
  child.stdout.write(event(`exec_create: ${marker}`, boundary, "b".repeat(64)));
  await assert.rejects(capture.waitForBarrier(marker, 10), /readiness barrier/);
});

test("spawn errors and bounded stderr remain visible for failure diagnosis", async (t) => {
  const { capture, child } = harness(t);
  const waiting = capture.waitForOom(boundary, 100);
  child.stderr.write("x".repeat(10_000));
  child.emit("error", new Error("synthetic unavailable daemon"));
  await assert.rejects(waiting, /could not run: synthetic unavailable daemon/);
  assert.equal(capture.diagnostics().stderr.length, 4_096);
  await assert.rejects(capture.waitForBarrier(marker), /could not run/);
});

test("unexpected stream termination fails evidence instead of becoming a timeout", async (t) => {
  const { capture, child, signals } = harness(t);
  const waiting = capture.waitForOom(boundary, 100);
  child.emit("close", 1, null);
  await assert.rejects(waiting, /ended before cleanup \(code=1/);
  await capture.close();
  assert.deepEqual(signals, []);
});

test("invalid or oversized stream data fails closed", async (t) => {
  for (const line of [
    "not JSON\n",
    event("oom", 1792800000123456790),
    event("oom", "not-a-timestamp"),
    "x".repeat(65_537),
  ]) {
    const { capture, child } = harness(t);
    const waiting = capture.waitForOom(boundary, 100);
    child.stdout.write(line);
    await assert.rejects(waiting, /invalid event|buffer limit/);
    await capture.close();
  }
});

test("retains only bounded event diagnostics", async (t) => {
  const { capture, child } = harness(t);
  for (let index = 0; index < 100; index++)
    child.stdout.write(event("start", String(index)));
  const diagnostics = capture.diagnostics();
  assert.equal(diagnostics.events.length, 16);
  assert.equal(diagnostics.events[0].timeNano, "84");
});

test("cleanup rejects pending waits, closes only its child and is idempotent", async (t) => {
  const { capture, signals } = harness(t);
  const pending = assert.rejects(
    capture.waitForBarrier(marker),
    /capture closed/,
  );
  await Promise.all([capture.close(), capture.close(), pending]);
  assert.deepEqual(signals, ["SIGTERM"]);
  await assert.rejects(capture.waitForOom(boundary), /capture closed/);
});

test("cleanup escalates an unresponsive event CLI and remains bounded", async (t) => {
  const { capture, child, signals } = harness(t, { killCloses: false });
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGKILL")
      queueMicrotask(() => child.emit("close", null, signal));
    return true;
  };
  await capture.close();
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("cleanup reports a child that never confirms termination", async (t) => {
  const { capture, signals } = harness(t, { killCloses: false });
  await assert.rejects(capture.close(), /did not close after SIGKILL/);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("real asynchronous child output is consumed and its process is reaped", async () => {
  let child;
  const capture = captureDockerOomEvents({
    containerId,
    since: "2026-10-24T00:00:00.000Z",
    spawnProcess: () => {
      child = spawn(
        process.execPath,
        [
          "-e",
          `process.stdout.write(${JSON.stringify(event(`exec_create: ${marker}`) + event("oom", "1792800000123456790"))}); setInterval(()=>{},1000)`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      return child;
    },
  });
  try {
    const barrier = await capture.waitForBarrier(marker, 5_000);
    assert.equal((await capture.waitForOom(barrier.timeNano)).action, "oom");
  } finally {
    await capture.close();
  }
  assert.equal(child.signalCode, "SIGTERM");
});
