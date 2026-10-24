import { spawn } from "node:child_process";

// Capture before the fault, and prove delivery with a unique exec_create event.
// A spawned CLI alone does not prove that the daemon subscription is connected.
export function captureDockerOomEvents({
  containerId,
  since,
  spawnProcess = spawn,
  closeTimeoutMs = 2_000,
}) {
  const child = spawnProcess(
    "docker",
    [
      "events",
      "--since",
      since,
      "--filter",
      "type=container",
      "--filter",
      `container=${containerId}`,
      "--format",
      '{"id":"{{.Actor.ID}}","action":{{json .Action}},"timeNano":"{{.TimeNano}}"}',
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let buffer = "";
  let stderr = "";
  let failure;
  let closing = false;
  let closed = false;
  let closePromise;
  const events = [];
  const waiters = new Set();
  let resolveClosed;
  const ended = new Promise((resolve) => (resolveClosed = resolve));

  function fail(error) {
    failure ??= error;
    for (const waiter of waiters) waiter.reject(failure);
  }

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4_096);
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.length > 65_536) {
      fail(new Error("Docker event stream exceeded its line buffer limit"));
      buffer = "";
      return;
    }
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (
          typeof event.id !== "string" ||
          typeof event.action !== "string" ||
          typeof event.timeNano !== "string" ||
          !/^\d+$/.test(event.timeNano)
        )
          throw new Error("Invalid event fields");
        if (event.id !== containerId) continue;
        events.push(event);
        if (events.length > 64) events.shift();
        for (const waiter of waiters)
          if (waiter.matches(event)) waiter.resolve(event);
      } catch {
        fail(new Error("Docker event stream returned an invalid event"));
      }
    }
  });
  child.once("error", (error) => {
    fail(new Error(`Docker event stream could not run: ${error.message}`));
  });
  child.once("close", (code, signal) => {
    closed = true;
    if (!closing)
      fail(
        new Error(
          `Docker event stream ended before cleanup (code=${code}, signal=${signal})`,
        ),
      );
    resolveClosed();
  });

  function waitFor(matches, description, timeoutMs) {
    if (failure) return Promise.reject(failure);
    if (closing)
      return Promise.reject(new Error("Docker event capture is closed"));
    const found = events.find(matches);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        clearTimeout(timer);
        waiters.delete(waiter);
        callback(value);
      };
      const waiter = {
        matches,
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
      };
      const timer = setTimeout(
        () => waiter.reject(new Error(`Timed out waiting for ${description}`)),
        timeoutMs,
      );
      waiters.add(waiter);
    });
  }

  async function waitForClose(timeoutMs) {
    if (closed) return true;
    let timer;
    const complete = await Promise.race([
      ended.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    return complete;
  }

  return {
    waitForBarrier(marker, timeoutMs = 10_000) {
      return waitFor(
        (event) =>
          event.action.startsWith("exec_create: ") &&
          event.action.includes(marker),
        "the Docker event stream readiness barrier",
        timeoutMs,
      );
    },
    waitForOom(afterNano, timeoutMs = 30_000) {
      const boundary = BigInt(afterNano);
      return waitFor(
        (event) => event.action === "oom" && BigInt(event.timeNano) > boundary,
        "Docker OOM evidence, not just a process restart",
        timeoutMs,
      );
    },
    diagnostics() {
      return {
        events: events.slice(-16).map((event) => ({
          ...event,
          action: event.action.slice(0, 2_048),
        })),
        stderr,
        error: failure?.message,
        closed,
      };
    },
    close() {
      closePromise ??= (async () => {
        closing = true;
        fail(new Error("Docker event capture closed"));
        if (closed) return;
        child.kill("SIGTERM");
        if (await waitForClose(closeTimeoutMs)) return;
        child.kill("SIGKILL");
        if (!(await waitForClose(closeTimeoutMs)))
          throw new Error("Docker event stream did not close after SIGKILL");
      })();
      return closePromise;
    },
  };
}
