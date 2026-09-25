import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);

// header zoom: clef + time sig
await page.screenshot({ path: "C:/dev/temp/opencode/timesig.png", clip: { x: 40, y: 150, width: 220, height: 120 } });

// click "+" twice
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => {
    const g = [...document.querySelectorAll("[data-stdb-action='add-bar']")].pop();
    g?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForTimeout(300);
}
const barCount = await page.evaluate(() => window.__sowerRenderer ? document.querySelectorAll("text.stdb-bar-number").length : -1);
console.log("after +2, bar-number labels:", barCount);

// click "-" once
await page.evaluate(() => {
  const g = [...document.querySelectorAll("[data-stdb-action='remove-bar']")].pop();
  g?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(300);

// press space to play, wait, capture playhead
await page.keyboard.press(" ");
await page.waitForTimeout(700);
const playheadVisible = await page.evaluate(() => {
  const lines = [...document.querySelectorAll(".stdb-score-overlay line")];
  return lines.some((l) => l.getAttribute("stroke") === "#4f8cff" && Number(l.getAttribute("x1")) > 100);
});
console.log("playhead visible while playing:", playheadVisible);
await page.screenshot({ path: "C:/dev/temp/opencode/playing.png", clip: { x: 0, y: 140, width: 1600, height: 180 } });
await page.keyboard.press(" ");
await browser.close();
