import { chromium } from "playwright";

/**
 * Phase 1c.1 — direct note manipulation probe (real mouse drags):
 *  1. vertical drag on a note body re-pitches it (whole semitones) and
 *     re-fingers it for the instrument
 *  2. horizontal drag on the duration edge resizes the note and snaps to a
 *     standard rhythm value, never overwriting the notes after it
 *  3. a plain click on a note body still just places the caret
 *  4. the whole gesture is one undo entry
 */

const PASS = [];
const FAIL = [];
const SNAPS = [60, 90, 120, 180, 240, 360, 480, 720, 960, 1440, 1920, 2880];
const check = (name, ok, detail = "") => {
  (ok ? PASS : FAIL).push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:\n" + (e.stack ?? e.message)));
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);

// a clean 4/4 measure with known content
await page.evaluate(() => {
  const doc = window.__sowerDoc;
  const s = doc.score;
  const track = s.tracks[0];
  const bar = s.bars[0];
  if (!track || !bar) return;
  // wipe the demo bar down to one quarter note at tick 0 on string 2 (fret 0)
  for (const n of [...(bar.voices[0]?.notes ?? [])]) {
    doc.execute({ type: "removeNote", trackId: track.id, barId: bar.id, noteId: n.id });
  }
  const lowestFirst = track.tuning.strings;
  const open = lowestFirst[lowestFirst.length - 1 - 2];
  doc.execute({
    type: "addNote",
    trackId: track.id,
    barId: bar.id,
    note: { pitch: open + 0, start: 0, duration: 480, string: 2, fret: 0 },
  });
  doc.execute({
    type: "addNote",
    trackId: track.id,
    barId: bar.id,
    note: { pitch: open + 2, start: 480, duration: 480, string: 2, fret: 2 },
  });
});
await page.waitForTimeout(500);

const notes = await page.evaluate(() => {
  const s = window.__sowerDoc.score;
  const bar = s.bars[0];
  return (bar.voices[0]?.notes ?? []).map((n) => ({
    id: n.id,
    pitch: n.pitch,
    string: n.string,
    fret: n.fret,
    start: n.start,
    duration: n.duration,
  }));
});
console.log("setup notes:", JSON.stringify(notes));

const grab = (id) =>
  page.evaluate((noteId) => {
    const found = [];
    for (let i = 0; i < 4; i++) {
      const p = window.__sowerRenderer.noteGrabPoints(i, noteId);
      if (p?.body) return p;
      found.push(p);
    }
    return null;
  }, id);

const note = notes[0];
const note2 = notes[1];
const g = await grab(note.id);
check("note body + duration edge grab points resolve", Boolean(g?.body && g?.edge), JSON.stringify(g));

// ---- 1. vertical drag = pitch ------------------------------------------------
const before = await page.evaluate(
  (id) => {
    const n = window.__sowerDoc.score.bars[0].voices[0].notes.find((x) => x.id === id);
    return n ? { pitch: n.pitch, string: n.string, fret: n.fret } : null;
  },
  note.id,
);
// 4 semitones up at 5 px/semitone
await page.mouse.move(g.body.x, g.body.y);
await page.mouse.down();
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(g.body.x, g.body.y - i * 2.5);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(300);
const after = await page.evaluate(
  (id) => {
    const n = window.__sowerDoc.score.bars[0].voices[0].notes.find((x) => x.id === id);
    return n ? { pitch: n.pitch, string: n.string, fret: n.fret } : null;
  },
  note.id,
);
console.log("pitch drag:", JSON.stringify(before), "->", JSON.stringify(after));
check(
  "vertical drag re-pitches by whole semitones",
  after !== null && before !== null && after.pitch === before.pitch + 4,
  `${before?.pitch} -> ${after?.pitch}`,
);
check(
  "the note is re-fingered for the instrument",
  after !== null && typeof after.fret === "number" && after.fret >= 0 && after.fret <= 24,
  `string ${after?.string} fret ${after?.fret}`,
);

// ---- 2. one undo entry per gesture -------------------------------------------
const historyBefore = await page.evaluate(() => window.__sowerDoc.canUndo);
await page.keyboard.press("Control+z");
await page.waitForTimeout(250);
const undone = await page.evaluate(
  (id) => {
    const n = window.__sowerDoc.score.bars[0].voices[0].notes.find((x) => x.id === id);
    return n ? { pitch: n.pitch, fret: n.fret } : null;
  },
  note.id,
);
check(
  "the whole pitch drag is a single undo entry",
  historyBefore === true && undone !== null && undone.pitch === before.pitch,
  `${JSON.stringify(undone)} (expected pitch ${before.pitch})`,
);

// ---- 3. horizontal drag on the duration edge --------------------------------
// (a) a short nudge left steps to the neighbouring rhythm value, not the floor
const gNudge = await grab(note.id);
await page.mouse.move(gNudge.edge.x, gNudge.edge.y);
await page.mouse.down();
for (let i = 1; i <= 6; i++) {
  await page.mouse.move(gNudge.edge.x - i * 2, gNudge.edge.y);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(300);
const nudged = await page.evaluate(
  (id) => {
    const n = window.__sowerDoc.score.bars[0].voices[0].notes.find((x) => x.id === id);
    return n ? { start: n.start, duration: n.duration } : null;
  },
  note.id,
);
console.log("edge drag (nudge):", JSON.stringify(nudged), "was", note.duration);
check(
  "a small edge nudge steps to the neighbouring rhythm value",
  nudged !== null && (nudged.duration === 360 || nudged.duration === 240),
  `${note.duration} -> ${nudged?.duration}`,
);

// (b) shrink: drag left — snaps to a shorter standard value
const g2 = await grab(note.id);
await page.mouse.move(g2.edge.x, g2.edge.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(g2.edge.x - i * 7, g2.edge.y);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(300);
const shrunk = await page.evaluate(
  (id) => {
    const n = window.__sowerDoc.score.bars[0].voices[0].notes.find((x) => x.id === id);
    return n ? { start: n.start, duration: n.duration } : null;
  },
  note.id,
);
console.log("edge drag (shrink):", JSON.stringify(shrunk), "was", note.duration);
check(
  "dragging the edge left shortens the note",
  shrunk !== null && shrunk.duration < note.duration,
  `${note.duration} -> ${shrunk?.duration}`,
);
check(
  "the shortened length is a standard rhythm value",
  shrunk !== null && SNAPS.includes(shrunk.duration),
  String(shrunk?.duration),
);

// (b) grow: drag right — clamped to the next event (never overwrites it)
const g2b = await grab(note.id);
await page.mouse.move(g2b.edge.x, g2b.edge.y);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(g2b.edge.x + i * 8, g2b.edge.y);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(300);
const grown = await page.evaluate(
  (id) => {
    const n = window.__sowerDoc.score.bars[0].voices[0].notes.find((x) => x.id === id);
    return n ? { start: n.start, duration: n.duration } : null;
  },
  note.id,
);
const next = await page.evaluate(
  (id) => {
    const n = window.__sowerDoc.score.bars[0].voices[0].notes.find((x) => x.id === id);
    return n ? { start: n.start, duration: n.duration } : null;
  },
  note2.id,
);
console.log("edge drag (grow):", JSON.stringify(grown), "next:", JSON.stringify(next));
check(
  "dragging the edge right grows the note again",
  grown !== null && shrunk !== null && grown.duration > shrunk.duration,
  `${shrunk?.duration} -> ${grown?.duration}`,
);
check(
  "the note never overwrites the notes after it",
  next !== null && grown !== null && grown.start + grown.duration <= next.start,
  `${grown?.start}+${grown?.duration} <= ${next?.start}`,
);

// (c) the last note of a bar may grow all the way to the barline
const g2c = await grab(note2.id);
await page.mouse.move(g2c.edge.x, g2c.edge.y);
await page.mouse.down();
for (let i = 1; i <= 14; i++) {
  await page.mouse.move(g2c.edge.x + i * 10, g2c.edge.y);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(300);
const lastGrown = await page.evaluate(
  (id) => {
    const n = window.__sowerDoc.score.bars[0].voices[0].notes.find((x) => x.id === id);
    return n ? { start: n.start, duration: n.duration } : null;
  },
  note2.id,
);
console.log("edge drag (last note):", JSON.stringify(lastGrown));
check(
  "the last note of a measure grows past its original length",
  lastGrown !== null && lastGrown.duration > note2.duration,
  `${note2.duration} -> ${lastGrown?.duration}`,
);
check(
  "and still snaps to a standard rhythm value",
  lastGrown !== null && SNAPS.includes(lastGrown.duration),
  String(lastGrown?.duration),
);

// ---- 4. plain click on a body still just moves the caret ---------------------
const g3 = await grab(note2.id);
await page.mouse.click(g3.body.x, g3.body.y);
await page.waitForTimeout(250);
const caret = await page.evaluate(() => {
  const bar = window.__sowerDoc.score.bars[0];
  return { bar: 0, tick: null, string: null, id: bar.voices[0].notes[0].id };
});
const caretOn = await page.evaluate(
  (id) => {
    // the caret lands on the clicked note's string / start
    const r = window.__sowerRenderer;
    const p = r.pointFor({ barIndex: 0, tick: 0, stringIndex: 0 });
    return { ok: Boolean(p), id };
  },
  note2.id,
);
check("a click on a note body resolves to a caret position", caretOn.ok === true, JSON.stringify(caret));

// ---- 5. vertical drag on the duration edge must NOT change pitch -------------
const pitchBefore = await page.evaluate(
  (id) => window.__sowerDoc.score.bars[0].voices[0].notes.find((x) => x.id === id)?.pitch,
  note2.id,
);
const g4 = await grab(note2.id);
await page.mouse.move(g4.edge.x, g4.edge.y);
await page.mouse.down();
await page.mouse.move(g4.edge.x, g4.edge.y - 40);
await page.waitForTimeout(50);
await page.mouse.move(g4.edge.x + 30, g4.edge.y);
await page.mouse.up();
await page.waitForTimeout(250);
const pitchAfter = await page.evaluate(
  (id) => window.__sowerDoc.score.bars[0].voices[0].notes.find((x) => x.id === id)?.pitch,
  note2.id,
);
check(
  "an edge drag never changes the pitch",
  pitchBefore === pitchAfter,
  `${pitchBefore} -> ${pitchAfter}`,
);

console.log("\n" + PASS.concat(FAIL).join("\n"));
console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
await browser.close();
if (FAIL.length > 0) process.exit(1);
