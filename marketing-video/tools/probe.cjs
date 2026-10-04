// Prints the timeline (total seconds + per-scene start / narration start / duration) as JSON.
const { chromium } = require("playwright-core");
const path = require("path");
(async () => {
  const br = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--allow-file-access-from-files"],
  });
  const p = await br.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto("file://" + path.resolve(__dirname, "../src/index.html"));
  await p.waitForFunction("window.READY===true");
  console.log(JSON.stringify({ total: await p.evaluate("TOTAL"), scenes: await p.evaluate("SCENES") }));
  await br.close();
})();
