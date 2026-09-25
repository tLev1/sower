import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const r = window.__sowerRenderer;
  const orig = r.loadScore.bind(r);
  window.__loads = [];
  r.loadScore = (s) => { window.__loads.push(s.bars.length); return orig(s); };
});
const findBtn = (action) =>
  page.evaluate((action) => {
    const els = [...document.querySelectorAll(`[data-stdb-action="${action}"]`)];
    const g = els[els.length - 1];
    if (!g) return null;
    const r = g.querySelector("rect").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, action);
const countBars = () =>
  page.evaluate(() => {
    let i = 0;
    while (window.__sowerRenderer.getBarRect(i)) i++;
    return i;
  });
console.log("start bars:", await countBars());
let b = await findBtn("add-bar");
await page.mouse.click(b.x, b.y);
await page.waitForTimeout(500);
console.log("after +: loads =", JSON.stringify(await page.evaluate(() => window.__loads)));
const rm = await findBtn("remove-bar");
await page.mouse.click(rm.x, rm.y);
await page.waitForTimeout(700);
console.log("after -: loads =", JSON.stringify(await page.evaluate(() => window.__loads)), "bars =", await countBars());
await browser.close();
