import { chromium } from "playwright";

const PASS = [];
const FAIL = [];
const check = (name, ok, detail = "") => {
  (ok ? PASS : FAIL).push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGE ERROR:\n" + (e.stack ?? e.message)));
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);

// ---- A. playhead starts AT the selection and moves immediately ---------------
const addBtn = await page.evaluate(() => {
  const el = document.querySelector('[data-stdb-action="add-bar"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(addBtn.x, addBtn.y);
await page.waitForTimeout(400);
await page.click('.duration-picker .duration-btn[title="Quarter note"]');
await page.waitForTimeout(150);
const emptyPoint = await page.evaluate(() =>
  window.__stdbRenderer.pointFor({ barIndex: 2, tick: 0, stringIndex: 2 }),
);
await page.mouse.click(emptyPoint.x, emptyPoint.y);
await page.waitForTimeout(150);
await page.keyboard.press("5");
await page.waitForTimeout(250);

// caret back ON the quarter (tick 0): caret auto-advanced to 480 → ← twice
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(150);
// warm-up play (absorbs one-time headless resume latency)
await page.evaluate(() => window.__stdbRenderer.play());
await page.waitForTimeout(1200);
await page.evaluate(() => window.__stdbRenderer.stop());
await page.waitForTimeout(500);

const run = await page.evaluate(() => {
  const r = window.__stdbRenderer;
  const t0 = performance.now();
  const samples = [];
  const off = r.onPositionChanged((pos) => {
    if (samples.length < 400) {
      samples.push({ t: Math.round(performance.now() - t0), bar: pos?.barIndex, tick: pos ? Math.round(pos.tick) : null });
    }
  });
  r.play();
  return new Promise((resolve) => {
    setTimeout(() => { off(); resolve(samples.filter(Boolean)); }, 1800);
  });
});
const first = run.find((s) => s.bar === 2);
const ticks = run.filter((s) => s.bar === 2).map((s) => s.tick).filter((t) => t !== null);
const monotonic = ticks.every((t, i) => i === 0 || t >= ticks[i - 1]);
check(
  "playhead starts at the selected note (tick 0) within 80ms",
  first !== undefined && first.t < 80 && first.tick < 40,
  first ? `first sample t=${first.t}ms tick=${first.tick}` : "never reached bar 3",
);
check(
  "playhead advances immediately (no hold on the quarter)",
  monotonic && ticks.length > 20 && ticks[ticks.length - 1] - ticks[0] > 700,
  `samples=${ticks.length} last tick=${ticks[ticks.length - 1]}`,
);
await page.evaluate(() => window.__stdbRenderer.stop());
await page.waitForTimeout(500);

// ---- B. carry-over: caret INSIDE the sounding quarter (tick 240) --------------
await page.keyboard.press("ArrowRight"); // tick 0 → 240 (quarter still sounding)
const carryRun = await page.evaluate(() => {
  const t0 = performance.now();
  let fired = null;
  let delta = null;
  const origStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (fired === null) {
      fired = performance.now() - t0;
      delta = (args[0] - this.context.currentTime) * 1000;
    }
    return origStart.apply(this, args);
  };
  window.__stdbRenderer.play();
  return new Promise((resolve) => {
    setTimeout(() => {
      AudioBufferSourceNode.prototype.start = origStart;
      resolve({ fired, delta });
    }, 1500);
  });
});
check(
  "carry-over note sounds immediately from mid-note start",
  carryRun.fired !== null && carryRun.fired < 120,
  `first source at ${carryRun.fired?.toFixed(1) ?? "never"}ms (Δ ${carryRun.delta?.toFixed(1) ?? "?"}ms)`,
);
await page.evaluate(() => window.__stdbRenderer.stop());
await page.waitForTimeout(400);

// ---- C. rest fill (4/4 bar with a quarter at beat 1) --------------------------
const rests = await page.evaluate(() => {
  const svg = document.querySelector(".stdb-score-static");
  const restGlyphs = [...(svg?.querySelectorAll("text.stdb-rest") ?? [])];
  return restGlyphs.map((t) => [...(t.textContent ?? "")].map((c) => c.codePointAt(0)).join("/"));
});
// quarter E4E5=58597, half E4E4=58596 — bar 3: half rest + quarter rest expected
check(
  "remainder rest fill → half + quarter rests (Gould decomposition)",
  rests.includes("58596") && rests.includes("58597"),
  JSON.stringify(rests),
);

// ---- D. mid-system time signature change engraved (6/8 on bar 3) --------------
const bar3Point = await page.evaluate(() =>
  window.__stdbRenderer.pointFor({ barIndex: 2, tick: 0, stringIndex: 0 }),
);
await page.mouse.click(bar3Point.x, bar3Point.y, { button: "right" });
await page.waitForTimeout(250);
await page.click('.sheet-menu .sheet-menu-item:has-text("Time signature")');
await page.waitForTimeout(250);
await page.click('.meter-chip:has-text("6/8")');
await page.waitForTimeout(350);
await page.mouse.click(1300, 760);
await page.waitForTimeout(300);
const midSigs = await page.evaluate(() => {
  const svg = document.querySelector(".stdb-score-static");
  const blocks = [...(svg?.querySelectorAll("text.stdb-time-sig") ?? [])];
  return blocks.map((t) => [...(t.textContent ?? "")].map((c) => c.codePointAt(0)).join("/"));
});
// per-digit glyphs: 4 = 0xE084(57476); 6 = 0xE086(57478); 8 = 0xE088(57480)
const count4 = midSigs.filter((cp) => cp === "57476").length;
const has6 = midSigs.includes("57478");
const has8 = midSigs.includes("57480");
check(
  "meter change engraved at the mid-system bar (4/4 then 6/8)",
  count4 === 2 && has6 && has8,
  JSON.stringify(midSigs),
);

await page.screenshot({ path: "C:/dev/temp/opencode/v3-sheet.png", fullPage: false });

console.log("\n--- RESULTS ---");
for (const line of [...PASS, ...FAIL]) console.log(line);
console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
await browser.close();
if (FAIL.length > 0) process.exit(1);
