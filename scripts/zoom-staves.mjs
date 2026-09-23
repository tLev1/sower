import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2200);
const clip = await page.evaluate(() => {
  const svg = document.querySelector(".stdb-score-static");
  const r = svg.getBoundingClientRect();
  return { x: 0, y: Math.max(0, r.top), width: 1600, height: Math.min(330, r.height) };
});
await page.screenshot({ path: "C:/dev/temp/opencode/staves.png", clip });
await browser.close();
