const fs = require("node:fs");

if (process.argv[1]?.endsWith("dist/index.js")) {
  const allocations = [];
  let triggered = false;
  const timer = setInterval(() => {
    if (!triggered) {
      if (!fs.existsSync("/tmp/trigger-oom")) return;
      fs.unlinkSync("/tmp/trigger-oom");
      triggered = true;
    }
    // Touch external memory in the application process so cgroup OOM, not V8's heap limit, ends it.
    allocations.push(Buffer.alloc(16 * 1024 * 1024, 1));
  }, 20);
  timer.unref();
}
