import { chromium } from "playwright";

/**
 * Keymap regression — the editor dispatches through the central shortcut
 * registry, so this guards that every default binding still reaches its
 * action (fret entry incl. two-digit, rests, articulations, delete, undo).
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

const clearBar = () =>
  page.evaluate(() => {
    const doc = window.__sowerDoc;
    const s = doc.score;
    const bar = s.bars[0];
    for (const n of [...(bar.voices[0]?.notes ?? [])]) {
      doc.execute({ type: "removeNote", trackId: s.tracks[0].id, barId: bar.id, noteId: n.id });
    }
    for (const r of [...(bar.voices[0]?.rests ?? [])]) {
      doc.execute({
        type: "removeRange",
        trackId: s.tracks[0].id,
        barId: bar.id,
        start: r.start,
        duration: r.duration,
      });
    }
  });
const notes = () =>
  page.evaluate(() =>
    (window.__sowerDoc.score.bars[0].voices[0].notes ?? []).map((n) => ({
      fret: n.fret,
      start: n.start,
      kinds: n.articulations.map((a) => a.kind),
    })),
  );
const rests = () =>
  page.evaluate(() =>
    (window.__sowerDoc.score.bars[0].voices[0].rests ?? []).map((r) => ({ start: r.start, duration: r.duration })),
  );

// the caret click point must be recomputed after every re-layout
const clickCaret = async () => {
  const pt = await page.evaluate(() =>
    window.__sowerRenderer.pointFor({ barIndex: 0, tick: 0, stringIndex: 0 }),
  );
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(180);
};

await clearBar();
await page.waitForTimeout(250);
await clickCaret();

// ---- digit entry -----------------------------------------------------------
await page.keyboard.press("Digit5");
await page.waitForTimeout(150);
await page.keyboard.press("Digit7");
await page.waitForTimeout(150);
let n = await notes();
check(
  "digit keys place frets and auto-advance",
  n.length === 2 && n[0]?.fret === 5 && n[1]?.fret === 7 && n[1]?.start === n[0]?.start + 240,
  JSON.stringify(n),
);

// ---- two-digit fret entry --------------------------------------------------
await clearBar();
await page.waitForTimeout(200);
await clickCaret();
await page.keyboard.press("Control+1");
await page.waitForTimeout(120);
const pending = await page.evaluate(() => document.querySelector(".status-bar").innerText.split("\n")[0] ?? "");
check("Ctrl+1 arms the two-digit fret entry", pending.includes("Fret 1_"), pending);
await page.keyboard.press("Digit5");
await page.waitForTimeout(200);
n = await notes();
check("the next digit completes a two-digit fret", n.length === 1 && n[0]?.fret === 15, JSON.stringify(n));

await page.keyboard.press("Control+2");
await page.waitForTimeout(120);
await page.keyboard.press("Control+2");
await page.waitForTimeout(200);
n = await notes();
check(
  "the tens digit can be repeated with Ctrl held (fret 22)",
  n.some((x) => x.fret === 22),
  JSON.stringify(n),
);

// ---- rests + articulations -------------------------------------------------
await clearBar();
await page.waitForTimeout(200);
await clickCaret();
await page.keyboard.press("Digit3");
await page.waitForTimeout(150);
await page.keyboard.press("KeyB");
await page.waitForTimeout(200);
let r = await rests();
check("B writes a rest at the caret", r.length === 1 && r[0]?.start === 240, JSON.stringify(r));

await clickCaret();
await page.keyboard.press("KeyM");
await page.waitForTimeout(120);
await page.keyboard.press("KeyS");
await page.waitForTimeout(150);
n = await notes();
check(
  "M and S toggle palm-mute and staccato",
  n[0]?.kinds.includes("palmMute") === true && n[0]?.kinds.includes("staccato") === true,
  JSON.stringify(n[0]),
);
await page.keyboard.press("KeyM");
await page.waitForTimeout(150);
n = await notes();
check("pressing M again clears palm-mute", n[0]?.kinds.includes("palmMute") === false, JSON.stringify(n[0]));

// ---- delete + undo ---------------------------------------------------------
await page.keyboard.press("Delete");
await page.waitForTimeout(200);
n = await notes();
check("Delete removes the whole beat", n.length === 0, JSON.stringify(n));
await page.keyboard.press("Control+z");
await page.waitForTimeout(250);
n = await notes();
check("Ctrl+Z undoes the deletion", n.length === 1, JSON.stringify(n));
await page.keyboard.press("Control+Shift+z");
await page.waitForTimeout(250);
n = await notes();
check("Ctrl+Shift+Z redoes it", n.length === 0, JSON.stringify(n));

// ---- navigation ------------------------------------------------------------
await page.keyboard.press("Control+z");
await page.waitForTimeout(250);
const caret = async () =>
  page.evaluate(() => document.querySelector(".status-bar").innerText.split("\n")[0] ?? "");
const c0 = await caret();
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(150);
const c1 = await caret();
check("ArrowDown moves to the next string", c0 !== c1 && c1.includes("String 2"), `${c0} -> ${c1}`);

console.log("\n" + PASS.concat(FAIL).join("\n"));
console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
await browser.close();
if (FAIL.length > 0) process.exit(1);
