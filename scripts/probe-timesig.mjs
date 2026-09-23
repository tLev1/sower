import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);
const probe = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = "40px Bravura";
  const cp = String.fromCodePoint(0xe084); // timeSig4
  const m = ctx.measureText(cp);
  const loaded = document.fonts.check("40px Bravura");
  return {
    fontLoaded: loaded,
    width: m.width,
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent,
  };
});
console.log(JSON.stringify(probe));
await browser.close();
