import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGE ERROR:\n" + (e.stack ?? e.message)));
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(3000);

// caret back to bar 1 (primary tempo marker) — edit BPM to 140
await page.evaluate(() => {
  const r = window.__sowerRenderer.pointFor({ barIndex: 0, tick: 0, stringIndex: 0 });
  const ev = new PointerEvent("pointerdown", { clientX: r.x, clientY: r.y, bubbles: true });
  document.querySelector(".score-scroll").dispatchEvent(ev);
});
await page.waitForTimeout(200);
await page.fill(".field-input", "140");
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
const tempoHeader = await page.evaluate(() => document.querySelector(".stdb-tempo")?.textContent ?? "(none)");
const tempoField = await page.evaluate(() => document.querySelector(".field-input")?.value ?? "(none)");
console.log("header tempo after edit:", tempoHeader, "| transport field:", tempoField);

// time signature 3/4: expect digit glyphs 3 and 4 in the system header
await page.selectOption(".field-select", "3/4");
await page.waitForTimeout(600);
const sigGlyphs = await page.evaluate(() => {
  const svg = document.querySelector(".stdb-score-static");
  const digits = svg ? [...svg.querySelectorAll("text.stdb-time-sig")].map((t) => {
    const cp = [...t.textContent].map((c) => c.codePointAt(0)).join(",");
    return cp;
  }).join(" | ") : "(none)";
  return digits;
});
console.log("time-sig codepoints (expect 3=E083 4=E084):", sigGlyphs);
await page.screenshot({ path: "C:/dev/temp/opencode/transport.png", clip: { x: 0, y: 0, width: 1600, height: 340 } });
await browser.close();
