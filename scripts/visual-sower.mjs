import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const doc = window.__sowerDoc;
  doc.execute({ type: "setScoreMeta", title: "Autumn Song", artist: "J. Sower" });
  doc.execute({ type: "setKeySignature", barId: doc.score.bars[1].id, fifths: 2, mode: "major" });
});
await page.waitForTimeout(450);
const barPoint = await page.evaluate(() =>
  window.__sowerRenderer.pointFor({ barIndex: 0, tick: 240, stringIndex: 3 }),
);
await page.mouse.click(barPoint.x, barPoint.y, { button: "right" });
await page.waitForTimeout(250);
await page.click('.sheet-menu .sheet-menu-item:has-text("Add chord")');
await page.waitForTimeout(250);
await page.locator('select[aria-label="Chord"]').selectOption({ index: 0 }); // D (I)
await page.waitForTimeout(200);
await page.locator('select[aria-label="Chord inversion and position"]').selectOption({ index: 0 });
await page.locator('select[aria-label="Chord length"]').selectOption({ label: "Whole" });
await page.click(".sheet-popover-apply");
await page.waitForTimeout(350);
await page.mouse.click(30, 700);
await page.waitForTimeout(200);
await page.screenshot({ path: "C:/dev/temp/opencode/sower-sheet.png" });
console.log("done");
await browser.close();
