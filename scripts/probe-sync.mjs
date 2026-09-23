import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);
await page.keyboard.press(" ");
await page.waitForTimeout(150);
const xs = [];
for (let i = 0; i < 60; i++) {
  const x = await page.evaluate(() => {
    const line = document.querySelector(".stdb-dyn line");
    return line ? Number(line.getAttribute("x1")) : null;
  });
  xs.push(x);
  await page.waitForTimeout(60);
}
await page.keyboard.press(" ");
const nums = xs.filter((v) => v !== null).map((v) => Math.round(v));
const deltas = [];
for (let i = 1; i < nums.length; i++) deltas.push(nums[i] - nums[i - 1]);
const frozen = deltas.filter((d) => Math.abs(d) < 0.5).length;
const jumps = deltas.filter((d) => d > 60).length;
console.log("samples:", nums.length, "frozen(<0.5px):", frozen, "jumps(>60px):", jumps);
console.log("deltas min/max:", Math.min(...deltas).toFixed(1), "/", Math.max(...deltas).toFixed(1));
console.log("deltas:", deltas.join(","));
await browser.close();
