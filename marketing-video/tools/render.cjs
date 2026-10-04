// node tools/render.cjs <startFrame> <endFrame> <outDir> [fps]
// Seeks the deterministic timeline (window.render(t)) and writes JPEG frames.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const [a, b, out, fps] = [+process.argv[2], +process.argv[3], process.argv[4], +(process.argv[5] || 30)];
fs.mkdirSync(out, { recursive: true });
(async () => {
  const br = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--allow-file-access-from-files", "--disable-gpu"],
  });
  const p = await br.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto("file://" + path.resolve(__dirname, "../src/index.html"));
  await p.waitForFunction("window.READY===true");
  await p.waitForTimeout(1000);
  for (let f = a; f < b; f++) {
    await p.evaluate((t) => render(t), f / fps);
    await p.screenshot({ path: `${out}/f${String(f).padStart(6, "0")}.jpg`, type: "jpeg", quality: 92 });
  }
  await br.close();
})();
