import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2200);
// accidental: string 2 fret 1 -> G#/Ab (needs a flat in C major)
await page.evaluate(() => {
  const r = window.__stdbRenderer.pointFor({ barIndex: 0, tick: 480, stringIndex: 2 });
  const ev = new PointerEvent("pointerdown", { clientX: r.x, clientY: r.y, bubbles: true });
  document.querySelector(".score-scroll").dispatchEvent(ev);
});
await page.waitForTimeout(200);
await page.keyboard.press("1");
await page.waitForTimeout(300);
// deep low note: string 4 fret 0 -> A2, written A3 (2 ledger lines)
await page.evaluate(() => {
  const r = window.__stdbRenderer.pointFor({ barIndex: 0, tick: 960, stringIndex: 4 });
  const ev = new PointerEvent("pointerdown", { clientX: r.x, clientY: r.y, bubbles: true });
  document.querySelector(".score-scroll").dispatchEvent(ev);
});
await page.waitForTimeout(200);
await page.keyboard.press("0");
await page.waitForTimeout(400);
const clip = await page.evaluate(() => {
  const svg = document.querySelector(".stdb-score-static");
  const r = svg.getBoundingClientRect();
  return { x: 30, y: Math.max(0, r.top + 80), width: 700, height: 180 };
});
await page.screenshot({ path: "C:/dev/temp/opencode/staves3.png", clip });
await browser.close();
