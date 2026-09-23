import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);
await page.keyboard.press(" ");
await page.waitForTimeout(150);
const xs = [];
for (let i = 0; i < 26; i++) {
  const x = await page.evaluate(() => {
    const line = document.querySelector(".stdb-dyn line");
    return line ? Number(line.getAttribute("x1")) : null;
  });
  xs.push(x);
  await page.waitForTimeout(90);
}
await page.keyboard.press(" ");
const deltas = xs.map((x, i) => i === 0 ? null : (x !== null && xs[i-1] !== null ? Number((x - xs[i-1]).toFixed(1)) : null));
console.log("sampled x:", xs.slice(0, 10).map((v) => (v === null ? "null" : Math.round(v))).join(","));
console.log("deltas:", deltas.filter((d) => d !== null).join(","));
const backwards = deltas.filter((d) => d !== null && d < -1).length;
console.log("backward jumps:", backwards);
await browser.close();
