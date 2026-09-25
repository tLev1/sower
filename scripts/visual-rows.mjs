import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGE ERROR:\n" + (e.stack ?? e.message)));
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);

// build 6 measures to see the 4-per-row wrapping, then screenshot
await page.evaluate(() => {
  const doc = window.__sowerDoc;
  for (let i = 0; i < 4; i++) doc.execute({ type: "addBar", afterBarId: null });
});
await page.waitForTimeout(500);
const info = await page.evaluate(() => {
  const scroller = document.querySelector(".score-scroll");
  const r = window.__sowerRenderer;
  const rows = [0, 3, 4, 5].map((i) => r.getBarRect(i)?.y ?? -1);
  return {
    scrollW: scroller.scrollWidth,
    clientW: scroller.clientWidth,
    bars: window.__sowerDoc.score.bars.length,
    rows,
  };
});
console.log(JSON.stringify(info));
await page.screenshot({ path: "C:/dev/temp/opencode/rows-fresh.png" });
await browser.close();
