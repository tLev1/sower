import { chromium } from "playwright";

/**
 * Phase 1c.2 — hum / sing correction input (end-to-end, synthetic mic):
 *  1. the hum control appears in the status bar and arms the microphone
 *  2. while listening the live pitch read-out follows the input
 *  3. Correct mode re-pitches the selected note to what was sung
 *  4. Enter mode writes a quantised phrase from the caret
 *  5. one undo entry per capture
 *
 * The "microphone" is an oscillator driven into a MediaStreamDestination —
 * a real getUserMedia call is not possible (or deterministic) headless.
 */

const PASS = [];
const FAIL = [];
const check = (name, ok, detail = "") => {
  (ok ? PASS : FAIL).push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:\n" + (e.stack ?? e.message)));
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);

// one known quarter note at tick 0 on string 2 (fret 0 → pitch 55)
await page.evaluate(() => {
  const doc = window.__sowerDoc;
  const s = doc.score;
  const track = s.tracks[0];
  const bar = s.bars[0];
  if (!track || !bar) return;
  for (const n of [...(bar.voices[0]?.notes ?? [])]) {
    doc.execute({ type: "removeNote", trackId: track.id, barId: bar.id, noteId: n.id });
  }
  doc.execute({
    type: "addNote",
    trackId: track.id,
    barId: bar.id,
    note: { pitch: 55, start: 0, duration: 480, string: 2, fret: 0 },
  });
});
await page.waitForTimeout(400);

// user gesture first (autoplay policy), then arm a synthetic microphone
await page.mouse.click(400, 400);
await page.waitForTimeout(300);
await page.evaluate(() => {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  osc.frequency.value = 220; // A3 = MIDI 57
  osc.start();
  window.__humCtx = ctx;
  window.__humOsc = osc;
  // a FRESH stream per request — stopping a capture stops its tracks
  window.__humStream = () => {
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    return dest.stream;
  };
  navigator.mediaDevices.getUserMedia = async () => {
    if (ctx.state === "suspended") await ctx.resume();
    return window.__humStream();
  };
});

// ---- 1. the control exists and arms the mic --------------------------------
const humBtn = page.locator(".hum-btn");
check("the Hum control is in the status bar", (await humBtn.count()) === 1);
await humBtn.click();
await page.waitForTimeout(1500);
const listening = await page.evaluate(() => document.querySelector(".hum-btn")?.classList.contains("on") ?? false);
check("clicking Hum starts the capture", listening === true);

// ---- 2. live pitch read-out -------------------------------------------------
const live = await page.evaluate(() => ({
  pitch: document.querySelector(".hum-pitch")?.textContent ?? "",
  level: document.querySelector(".hum-level-fill")?.style.width ?? "",
}));
console.log("live:", JSON.stringify(live));
check("the live pitch read-out hears A3", live.pitch.includes("A3"), live.pitch);
check("the input level meter moves", parseFloat(live.level) > 0, live.level);

// ---- 3. Correct mode re-pitches the selected note --------------------------
const caretPoint = await page.evaluate(() =>
  window.__sowerRenderer.pointFor({ barIndex: 0, tick: 0, stringIndex: 2 }),
);
await page.mouse.click(caretPoint.x, caretPoint.y);
await page.waitForTimeout(250);
await humBtn.click(); // stop → apply
await page.waitForTimeout(500);
const corrected = await page.evaluate(() => {
  const n = window.__sowerDoc.score.bars[0].voices[0].notes[0];
  return n ? { pitch: n.pitch, fret: n.fret, string: n.string } : null;
});
console.log("corrected:", JSON.stringify(corrected));
check(
  "Correct mode re-pitches the note to the sung pitch",
  corrected !== null && corrected.pitch === 57,
  `${JSON.stringify(corrected)} (expected 57)`,
);

// ---- 4. one undo entry per capture -----------------------------------------
const canUndo = await page.evaluate(() => window.__sowerDoc.canUndo);
await page.keyboard.press("Control+z");
await page.waitForTimeout(300);
const undone = await page.evaluate(() => window.__sowerDoc.score.bars[0].voices[0].notes[0]?.pitch);
check("the whole capture is a single undo entry", canUndo === true && undone === 55, `pitch ${undone}`);

// ---- 5. Enter mode writes a quantised phrase -------------------------------
await page.evaluate(() => {
  const doc = window.__sowerDoc;
  const s = doc.score;
  const track = s.tracks[0];
  const bar = s.bars[0];
  for (const n of [...(bar.voices[0]?.notes ?? [])]) {
    doc.execute({ type: "removeNote", trackId: track.id, barId: bar.id, noteId: n.id });
  }
});
await page.waitForTimeout(300);
await page.locator(".hum-mode", { hasText: "Enter" }).click();
const enterActive = await page.evaluate(
  () => document.querySelectorAll(".hum-mode")[1]?.classList.contains("active") ?? false,
);
check("the mode switcher toggles to Enter", enterActive === true);
const caretPoint2 = await page.evaluate(() =>
  window.__sowerRenderer.pointFor({ barIndex: 0, tick: 0, stringIndex: 2 }),
);
await page.mouse.click(caretPoint2.x, caretPoint2.y);
await page.waitForTimeout(250);
await humBtn.click();
await page.waitForTimeout(1200);
await humBtn.click();
await page.waitForTimeout(500);
const entered = await page.evaluate(() =>
  (window.__sowerDoc.score.bars[0].voices[0].notes ?? []).map((n) => ({
    start: n.start,
    duration: n.duration,
    pitch: n.pitch,
    fret: n.fret,
  })),
);
console.log("entered:", JSON.stringify(entered));
check("Enter mode writes notes from the caret", entered.length >= 1, JSON.stringify(entered));
check(
  "the written notes are quantised to the entry grid",
  entered.every((n) => Number.isInteger(n.start) && n.duration >= 60),
  JSON.stringify(entered),
);

console.log("\n" + PASS.concat(FAIL).join("\n"));
console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
await browser.close();
if (FAIL.length > 0) process.exit(1);
