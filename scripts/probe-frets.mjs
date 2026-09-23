import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);

// two-digit entry: Ctrl+1 then 5 -> fret 15 on string 0 at beat 1
await page.evaluate(() => {
  const r = window.__stdbRenderer.pointFor({ barIndex: 0, tick: 0, stringIndex: 0 });
  const ev = new PointerEvent("pointerdown", { clientX: r.x, clientY: r.y, bubbles: true });
  document.querySelector(".score-scroll").dispatchEvent(ev);
});
await page.waitForTimeout(150);
await page.keyboard.press("Control+1");
await page.waitForTimeout(150);
const pending = await page.locator(".status-bar").innerText();
console.log("status while pending:", pending.split("\n")[0]);
await page.keyboard.press("5");
await page.waitForTimeout(400);
// fret 22 on beat 2: Ctrl+2 then Ctrl+2 (ctrl held both digits)
await page.keyboard.press("Control+2");
await page.waitForTimeout(120);
await page.keyboard.press("Control+2");
await page.waitForTimeout(400);
// fret 10 on beat 3: Ctrl+1 then 0
await page.keyboard.press("Control+1");
await page.waitForTimeout(120);
await page.keyboard.press("0");
await page.waitForTimeout(500);
const status = await page.locator(".status-bar").innerText();
console.log("status after entries:", status.split("\n")[0]);

// screenshot: notation with high-fret leger lines + tab with two-digit frets
const clip = await page.evaluate(() => {
  const svg = document.querySelector(".stdb-score-static");
  const r = svg.getBoundingClientRect();
  return { x: 0, y: Math.max(0, r.top), width: 800, height: Math.min(360, r.height) };
});
await page.screenshot({ path: "C:/dev/temp/opencode/highfrets.png", clip });
await browser.close();
