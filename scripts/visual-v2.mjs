import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGE ERROR:\n" + (e.stack ?? e.message)));
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);

// open the tempo popover on the header tempo mark and set ♪. = 85
const tempoClick = await page.evaluate(() => {
  const hit = document.querySelector('.stdb-score-overlay [data-stdb-action="edit-tempo"]');
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(tempoClick.x, tempoClick.y);
await page.waitForTimeout(300);
await page.click('.tempo-units .glyph-btn[title="Eighth note"]');
await page.click('.tempo-units .glyph-btn.dot');
await page.fill(".sheet-popover-input", "85");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
await page.screenshot({ path: "C:/dev/temp/opencode/v2-tempo-popover.png", clip: { x: 0, y: 0, width: 1600, height: 400 } });

// close, then set the meter 7/8 through the time-sig popover
await page.mouse.click(1300, 720);
await page.waitForTimeout(250);
const tsClick = await page.evaluate(() => {
  const hit = document.querySelector('.stdb-score-overlay [data-stdb-action="edit-time-sig"]');
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(tsClick.x, tsClick.y);
await page.waitForTimeout(300);
await page.click('.meter-chip:has-text("7/8")');
await page.waitForTimeout(400);
await page.mouse.click(1300, 720);
await page.waitForTimeout(300);

// full sheet with the new marks
await page.screenshot({ path: "C:/dev/temp/opencode/v2-sheet.png", fullPage: false });

// context menu open state
const bar2Point = await page.evaluate(() =>
  window.__stdbRenderer.pointFor({ barIndex: 1, tick: 240, stringIndex: 1 }),
);
await page.mouse.click(bar2Point.x, bar2Point.y, { button: "right" });
await page.waitForTimeout(300);
await page.screenshot({ path: "C:/dev/temp/opencode/v2-context-menu.png", fullPage: false });

console.log("done");
await browser.close();
