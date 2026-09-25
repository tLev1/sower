import { chromium } from "playwright";

/**
 * Verification for the 2026-09 sheet-editing batch:
 *  1. play-from-selection → sound scheduled + playhead start instantly
 *  2. right-click context menu offers tempo / meter / measure actions
 *  3. entry note-value palette: placed notes use the selected duration
 *  4. tempo mark on the sheet opens the tempo popover (unit + dotted + BPM)
 *  5. time-signature block opens the meter popover
 */

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

// ---- 1. play-from-selection latency -------------------------------------------
// caret at bar 2 beat 1 (second bar of the demo); a REAL click grants the
// user activation the AudioContext prewarm needs (synthetic events do not)
const caretPoint = await page.evaluate(() =>
  window.__stdbRenderer.pointFor({ barIndex: 1, tick: 0, stringIndex: 2 }),
);
await page.mouse.click(caretPoint.x, caretPoint.y);
await page.waitForTimeout(150);

// warm-up play: absorbs the one-time AudioContext resume latency (in real use
// the context is prewarmed on the first pointer gesture — measure run 2)
await page.evaluate(() => window.__stdbRenderer.play());
await page.waitForTimeout(1200);
await page.evaluate(() => window.__stdbRenderer.stop());
await page.waitForTimeout(600);

const playResult = await page.evaluate(() => {
  const r = window.__stdbRenderer;
  const t0 = performance.now();
  return new Promise((resolve) => {
    let firstSourceAt = null;
    let latencyMs = null;
    const origStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (firstSourceAt === null && typeof args[0] === "number") {
        firstSourceAt = performance.now() - t0;
        latencyMs = ((this.context.outputLatency ?? 0) + (this.context.baseLatency ?? 0)) * 1000;
      }
      return origStart.apply(this, args);
    };
    let selectedAt;
    const off = r.onPositionChanged((pos) => {
      if (pos && pos.barIndex === 1 && selectedAt === undefined) {
        selectedAt = performance.now() - t0;
      }
    });
    let aliveMidPlay = false;
    setTimeout(() => {
      aliveMidPlay = r.isPlaying;
    }, 1500);
    r.play();
    setTimeout(() => {
      off();
      AudioBufferSourceNode.prototype.start = origStart;
      resolve({ firstSourceAt, selectedAt: selectedAt ?? null, latencyMs, aliveMidPlay });
    }, 2500);
  });
});
check(
  "first note scheduled immediately after play",
  playResult.firstSourceAt !== null && playResult.firstSourceAt < 80,
  `first source scheduled ${playResult.firstSourceAt?.toFixed(1) ?? "never"}ms after play()` +
    ` (device output latency ${playResult.latencyMs?.toFixed(0) ?? "?"}ms)`,
);
check(
  "playhead tracks the audible position (selected bar within latency + 150ms)",
  playResult.selectedAt !== null && playResult.selectedAt < (playResult.latencyMs ?? 0) + 150,
  `playhead entered bar 2 at ${playResult.selectedAt ?? "never"}ms`,
);
check("playback still running (no early stop)", playResult.aliveMidPlay === true);
await page.evaluate(() => window.__stdbRenderer.stop());
await page.waitForTimeout(500);

// ---- 2. right-click context menu ------------------------------------------------
const bar2Point = await page.evaluate(() =>
  window.__stdbRenderer.pointFor({ barIndex: 1, tick: 480, stringIndex: 3 }),
);
await page.mouse.click(bar2Point.x, bar2Point.y, { button: "right" });
await page.waitForTimeout(250);
const menuInfo = await page.evaluate(() => {
  const menu = document.querySelector(".sheet-menu");
  const items = menu ? [...menu.querySelectorAll(".sheet-menu-item")].map((b) => b.textContent?.trim()) : [];
  return { open: menu !== null, items };
});
check(
  "right-click opens context menu with actions",
  menuInfo.open === true &&
    menuInfo.items.some((t) => t?.includes("Tempo")) &&
    menuInfo.items.some((t) => t?.includes("Time signature")) &&
    menuInfo.items.some((t) => t?.includes("Insert measure")) &&
    menuInfo.items.some((t) => t?.includes("Delete measure")),
  JSON.stringify(menuInfo),
);
const barCountBefore = await page.evaluate(() => window.__stdbDoc.score.bars.length);
await page.click('.sheet-menu .sheet-menu-item:has-text("Insert measure after")');
await page.waitForTimeout(400);
const barCountAfterInsert = await page.evaluate(() => window.__stdbDoc.score.bars.length);
check("context menu inserts a measure", barCountAfterInsert === barCountBefore + 1, `before=${barCountBefore} after=${barCountAfterInsert}`);

// delete measure via the context menu on the NEW empty bar (now bar index 2)
const newBarPoint = await page.evaluate(() =>
  window.__stdbRenderer.pointFor({ barIndex: 2, tick: 0, stringIndex: 0 }),
);
await page.mouse.click(newBarPoint.x, newBarPoint.y, { button: "right" });
await page.waitForTimeout(250);
await page.click('.sheet-menu .sheet-menu-item:has-text("Delete measure")');
await page.waitForTimeout(400);
const barCountAfterDelete = await page.evaluate(() => window.__stdbDoc.score.bars.length);
check("context menu deletes the measure", barCountAfterDelete === barCountBefore, `after=${barCountAfterDelete}`);

// insert again for the duration-entry tests → empty 4/4 bar at index 2
const bar3Point = await page.evaluate(() =>
  window.__stdbRenderer.pointFor({ barIndex: 1, tick: 480, stringIndex: 3 }),
);
await page.mouse.click(bar3Point.x, bar3Point.y, { button: "right" });
await page.waitForTimeout(250);
await page.click('.sheet-menu .sheet-menu-item:has-text("Insert measure after")');
await page.waitForTimeout(400);

// ---- 3. entry note-value palette -------------------------------------------------
// quarter notes on the new empty 4/4 bar (string 4 has no demo notes)
await page.click('.duration-picker .duration-btn[title="Quarter note"]');
await page.waitForTimeout(150);
const emptyBarPoint = await page.evaluate(() =>
  window.__stdbRenderer.pointFor({ barIndex: 2, tick: 0, stringIndex: 4 }),
);
await page.mouse.click(emptyBarPoint.x, emptyBarPoint.y);
await page.waitForTimeout(120);
await page.keyboard.press("5");
await page.keyboard.press("7");
await page.waitForTimeout(300);
const placed = await page.evaluate(() => {
  const notes = window.__stdbDoc.score.bars[2].voices[0].notes;
  return notes.map((n) => ({ start: n.start, duration: n.duration, fret: n.fret }));
});
check(
  "quarter palette → placed notes are quarter notes (480)",
  placed.length === 2 &&
    placed.every((n) => n.duration === 480) &&
    placed.some((n) => n.start === 480),
  JSON.stringify(placed),
);

// dotted toggle → dotted quarter (720) — caret already advanced to tick 960
await page.click('.duration-picker .duration-btn.dot');
await page.waitForTimeout(150);
await page.keyboard.press("3");
await page.waitForTimeout(300);
const dottedNote = await page.evaluate(() => {
  const note = window.__stdbDoc.score.bars[2].voices[0].notes.find((n) => n.start === 960);
  return note ? { duration: note.duration, fret: note.fret } : null;
});
check("dot toggle → dotted quarter (720)", dottedNote?.duration === 720, JSON.stringify(dottedNote));

// ---- 4. tempo mark on the sheet opens the tempo popover ------------------------
const tempoClick = await page.evaluate(() => {
  const hit = document.querySelector('.stdb-score-overlay [data-stdb-action="edit-tempo"]');
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
check("tempo mark hit rect exists", tempoClick !== null);
if (tempoClick) {
  await page.mouse.click(tempoClick.x, tempoClick.y);
  await page.waitForTimeout(250);
  const open = await page.evaluate(() => document.querySelector(".sheet-popover .tempo-editor") !== null);
  check("tempo popover opens from the sheet mark", open === true);
  await page.click('.tempo-units .glyph-btn[title="Eighth note"]');
  await page.click('.tempo-units .glyph-btn.dot');
  await page.fill(".sheet-popover-input", "85");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const bar = window.__stdbDoc.score.bars[0];
    return { tempo: bar.tempo, unit: bar.tempoUnit ?? 480 };
  });
  check(
    "dotted-eighth tempo commit (♪. = 85 → unit 360)",
    state.tempo === 85 && state.unit === 360,
    JSON.stringify(state),
  );
  await page.mouse.click(1300, 700);
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => document.querySelector(".sheet-popover") === null);
  check("popover closes on outside click", closed === true);
}

// ---- 5. time signature popover from the sheet ---------------------------------
const tsClick = await page.evaluate(() => {
  const hit = document.querySelector('.stdb-score-overlay [data-stdb-action="edit-time-sig"]');
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
check("time-sig hit rect exists", tsClick !== null);
if (tsClick) {
  await page.mouse.click(tsClick.x, tsClick.y);
  await page.waitForTimeout(250);
  const open = await page.evaluate(() => document.querySelector(".sheet-popover .timesig-editor") !== null);
  check("meter popover opens from the sheet time-sig", open === true);
  await page.click('.meter-chip:has-text("6/8")');
  await page.waitForTimeout(300);
  const sigs = await page.evaluate(() => window.__stdbDoc.score.bars.map((b) => b.timeSignature));
  check(
    "6/8 applied from measure 1 onward",
    sigs.every((ts) => ts.numerator === 6 && ts.denominator === 8),
    JSON.stringify(sigs),
  );
  await page.mouse.click(1300, 700);
  await page.waitForTimeout(200);
}

// ---- 6. "Note length" from the context menu -----------------------------------
// palette is still dotted from section 3 — reset to plain values first
await page.click('.duration-picker .duration-btn.dot');
await page.waitForTimeout(150);
// right-click exactly on a written note (bar 2's first note: tick 0, string 3)
const notePoint = await page.evaluate(() =>
  window.__stdbRenderer.pointFor({ barIndex: 1, tick: 0, stringIndex: 3 }),
);
await page.mouse.click(notePoint.x, notePoint.y, { button: "right" });
await page.waitForTimeout(250);
await page.click('.sheet-menu .sheet-menu-item:has-text("Note length")');
await page.waitForTimeout(250);
const nlOpen = await page.evaluate(() => document.querySelector(".sheet-popover .tempo-editor") !== null);
check("note-length popover opens from the context menu", nlOpen === true);
await page.click('.tempo-units .glyph-btn[title="Quarter note"]');
await page.waitForTimeout(250);
const nl = await page.evaluate(() =>
  window.__stdbDoc.score.bars[1].voices[0].notes.map((n) => ({
    start: n.start,
    string: n.string,
    duration: n.duration,
  })),
);
const target = nl.find((n) => n.start === 0 && n.string === 3);
const later = nl.filter((n) => n.start > 0);
check(
  "note length changes ONLY the clicked note (notes after it untouched)",
  target?.duration === 480 && later.length > 0 && later.every((n) => n.duration === 240),
  `clicked=${JSON.stringify(target)} later=${JSON.stringify(later.slice(0, 3))}`,
);
const modeUpdated = await page.evaluate(
  () => document.querySelector('.duration-picker .duration-btn[title="Quarter note"]')?.classList.contains("active") ?? false,
);
check("entry duration mode updates too (future notes get it)", modeUpdated === true);
await page.mouse.click(1300, 760);
await page.waitForTimeout(200);

// ---- 7. naturally writable measure: four 16ths type side by side -------------
await page.click('.duration-picker .duration-btn[title="16th note"]');
await page.waitForTimeout(150);
const addBtn = await page.evaluate(() => {
  const el = document.querySelector('[data-stdb-action="add-bar"]');
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(addBtn.x, addBtn.y);
await page.waitForTimeout(400);
const emptyPoint = await page.evaluate(() =>
  window.__stdbRenderer.pointFor({ barIndex: 3, tick: 0, stringIndex: 2 }),
);
await page.mouse.click(emptyPoint.x, emptyPoint.y);
await page.waitForTimeout(150);
const glyphCount = () =>
  page.evaluate(() => {
    const s = document.querySelector(".stdb-score-static");
    return {
      flags: [...s.querySelectorAll("text.stdb-flag")].length,
      beams: [...s.querySelectorAll("polygon")].length,
    };
  });
const g0 = await glyphCount();
await page.keyboard.press("5");
await page.keyboard.press("7");
await page.keyboard.press("4");
await page.keyboard.press("2");
await page.waitForTimeout(300);
const sixteenths = await page.evaluate(() =>
  window.__stdbDoc.score.bars[3].voices[0].notes.map((n) => ({ start: n.start, duration: n.duration })),
);
check(
  "four typed 16ths land side by side (0,120,240,360 × 120)",
  sixteenths.length === 4 &&
    sixteenths.every((n, i) => n.start === i * 120 && n.duration === 120),
  JSON.stringify(sixteenths),
);
const g1 = await glyphCount();
check(
  "the four 16ths beam together (no flags, one beam group)",
  g1.flags === g0.flags && g1.beams - g0.beams === 6,
  `flags ${g0.flags}→${g1.flags}, beams ${g0.beams}→${g1.beams} (6 = 3 pairs × 2 beam levels = linked 16ths)`,
);
// writing over a rest region: click a 16th position deep in the rests and type
const deepPoint = await page.evaluate(() =>
  window.__stdbRenderer.pointFor({ barIndex: 3, tick: 600, stringIndex: 2 }),
);
await page.mouse.click(deepPoint.x, deepPoint.y);
await page.waitForTimeout(150);
await page.keyboard.press("3");
await page.waitForTimeout(250);
const deepNote = await page.evaluate(() =>
  window.__stdbDoc.score.bars[3].voices[0].notes.find((n) => n.fret === 3),
);
check(
  "a click deep in the rests writes at the clicked 16th (measure is modifiable)",
  deepNote?.start === 600,
  JSON.stringify(deepNote ? { start: deepNote.start, duration: deepNote.duration } : null),
);

await page.screenshot({ path: "C:/dev/temp/opencode/sheet-v2.png", fullPage: false });

console.log("\n--- RESULTS ---");
for (const line of [...PASS, ...FAIL]) console.log(line);
console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
await browser.close();
if (FAIL.length > 0) process.exit(1);
