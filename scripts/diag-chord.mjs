import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);
const barPoint = await page.evaluate(() =>
  window.__sowerRenderer.pointFor({ barIndex: 0, tick: 240, stringIndex: 3 }),
);
await page.mouse.click(barPoint.x, barPoint.y, { button: "right" });
await page.waitForTimeout(250);
await page.click('.sheet-menu .sheet-menu-item:has-text("Add chord")');
await page.waitForTimeout(250);
await page.locator(".chord-diatonic .meter-chip").first().click();
await page.waitForTimeout(450);
const info = await page.evaluate(() => {
  const svg = document.querySelector(".stdb-score-static");
  const chords = [...svg.querySelectorAll("text.stdb-chord")].map((t) => ({
    text: t.textContent,
    x: t.getAttribute("x"),
    y: t.getAttribute("y"),
  }));
  return {
    chords,
    modelSymbol: window.__sowerDoc.score.bars[0].chordSymbol,
  };
});
console.log(JSON.stringify(info));
await browser.close();
