const fs = require("node:fs");

if (process.argv[1]?.endsWith("dist/index.js")) {
  const timer = setInterval(() => {
    if (!fs.existsSync("/tmp/trigger-crash")) return;
    fs.unlinkSync("/tmp/trigger-crash");
    throw new Error("Synthetic crash-recovery test failure");
  }, 100);
  timer.unref();
}
