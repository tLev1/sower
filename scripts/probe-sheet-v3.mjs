import { chromium } from "playwright";

/**
 * Sheet v3 batch:
 *  1. editable title / author (header click → meta popover)
 *  2. key signature from the right-click menu (engraved at the change bar)
 *  3. "Add chord" from the right-click menu (key-aware map → symbol + tab)
 *  4. deletion model: Del = beat group, Backspace on rest = ripple
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

// room for the scenarios: 6 measures (4 + 2 rows)
await page.evaluate(() => {
  const doc = window.__sowerDoc;
  for (let i = 0; i < 4; i++) doc.execute({ type: "addBar", afterBarId: null });
});
await page.waitForTimeout(400);

// ---- 1. title / author editing ----------------------------------------------
await page.mouse.click(800, 110); // the centered title band
await page.waitForTimeout(250);
const metaOpen = await page.evaluate(() =>
  document.querySelector(".sheet-popover")?.textContent?.includes("Title & author") ?? false,
);
check("clicking the title opens the Title & author editor", metaOpen === true);
const titleInput = page.locator('input[aria-label="Score title"]');
const authorInput = page.locator('input[aria-label="Score author"]');
await titleInput.fill("Sower Anthem");
await titleInput.press("Enter");
await authorInput.fill("Jane Doe");
await authorInput.press("Enter");
await page.waitForTimeout(250);
const meta = await page.evaluate(() => ({
  title: window.__sowerDoc.score.title,
  artist: window.__sowerDoc.score.artist,
}));
check(
  "title and author commit to the score",
  meta.title === "Sower Anthem" && meta.artist === "Jane Doe",
  JSON.stringify(meta),
);
await page.mouse.click(800, 640);
await page.waitForTimeout(200);

// ---- 2. key signature from the context menu ----------------------------------
const bar2 = await page.evaluate(() =>
  window.__sowerRenderer.pointFor({ barIndex: 1, tick: 240, stringIndex: 3 }),
);
await page.mouse.click(bar2.x, bar2.y, { button: "right" });
await page.waitForTimeout(250);
await page.click('.sheet-menu .sheet-menu-item:has-text("Key signature")');
await page.waitForTimeout(250);
const keyOpen = await page.evaluate(() =>
  document.querySelector(".sheet-popover")?.textContent?.includes("Key signature") ?? false,
);
check("right-click offers Key signature", keyOpen === true);
await page.locator(".key-grid .meter-chip", { hasText: /^D$/ }).click();
await page.waitForTimeout(300);
const keyState = await page.evaluate(() => {
  const key = window.__sowerDoc.score.bars[1].keyChange;
  const svg = document.querySelector(".stdb-score-static");
  const sharps = [...svg.querySelectorAll("text.stdb-key-accidental")].length;
  return { key, sharps };
});
check(
  "key change engraves at its measure (D major = 2 sharps)",
  keyState.key?.fifths === 2 && keyState.key?.mode === "major" && keyState.sharps >= 2,
  JSON.stringify(keyState),
);
await page.mouse.click(800, 640);
await page.waitForTimeout(200);

// ---- 3. add chord (chord / inversion / length dropdowns + Add) ---------------
const bar3 = await page.evaluate(() =>
  window.__sowerRenderer.pointFor({ barIndex: 2, tick: 0, stringIndex: 3 }),
);
await page.mouse.click(bar3.x, bar3.y, { button: "right" });
await page.waitForTimeout(250);
await page.click('.sheet-menu .sheet-menu-item:has-text("Add chord")');
await page.waitForTimeout(250);
const chordUi = await page.evaluate(() => {
  const pop = document.querySelector(".sheet-popover");
  const selects = [...pop.querySelectorAll("select")].map((s) => s.getAttribute("aria-label"));
  const options = [...(pop.querySelector('select[aria-label="Chord"]')?.options ?? [])].map((o) => o.text);
  return { selects, options, hasAdd: pop.querySelector(".sheet-popover-apply") !== null };
});
check(
  "Add chord offers chord / inversion-position / length dropdowns + Add",
  chordUi.selects.length === 3 && chordUi.hasAdd,
  JSON.stringify(chordUi.selects),
);
check(
  "chord list follows the measure's key (D major → D, Em, A7…)",
  chordUi.options.some((o) => o.startsWith("D ")) &&
    chordUi.options.some((o) => o.includes("Em")) &&
    chordUi.options.some((o) => o.includes("A7")),
  JSON.stringify(chordUi.options.slice(0, 5)),
);
await page.locator('select[aria-label="Chord"]').selectOption({ index: 10 }); // vi = Bm
await page.waitForTimeout(250);
const voicings = await page.evaluate(() => {
  const sel = document.querySelector('select[aria-label="Chord inversion and position"]');
  return [...sel.options].map((o) => o.text);
});
check(
  "every inversion and position of the chord is available",
  voicings.length >= 4 && voicings.some((v) => v.includes("Root")) && voicings.some((v) => v.includes("inv.")),
  `${voicings.length} voicings, e.g. ${JSON.stringify(voicings.slice(0, 3))}`,
);
await page.locator('select[aria-label="Chord length"]').selectOption({ label: "Half" });
await page.locator('select[aria-label="Chord inversion and position"]').selectOption({ index: 1 });
await page.click(".sheet-popover-apply");
await page.waitForTimeout(350);
const chord = await page.evaluate(() => {
  const bar = window.__sowerDoc.score.bars[2];
  return {
    symbol: bar.chordSymbol,
    notes: bar.voices[0].notes.map((n) => ({ start: n.start, duration: n.duration, string: n.string, fret: n.fret })),
  };
});
check(
  "chord writes symbol + chosen voicing for the chosen length (Bm, half)",
  chord.symbol === "Bm" &&
    chord.notes.length >= 2 &&
    chord.notes.every((n) => n.start === 0 && n.duration === 960),
  JSON.stringify(chord).slice(0, 140),
);
// deleting the chord's notes must also remove the symbol above the staff
const chordPoint = await page.evaluate(() =>
  window.__sowerRenderer.pointFor({ barIndex: 2, tick: 0, stringIndex: 0 }),
);
await page.mouse.click(chordPoint.x, chordPoint.y);
await page.waitForTimeout(150);
await page.keyboard.press("Delete");
await page.waitForTimeout(300);
const afterChordDel = await page.evaluate(() => ({
  symbol: window.__sowerDoc.score.bars[2].chordSymbol ?? null,
  notes: window.__sowerDoc.score.bars[2].voices[0].notes.length,
  svgSymbols: document.querySelectorAll(".stdb-score-static text.stdb-chord").length,
}));
check(
  "deleting a chord removes its symbol too (nothing lingers)",
  afterChordDel.notes === 0 && afterChordDel.symbol === null && afterChordDel.svgSymbols === 0,
  JSON.stringify(afterChordDel),
);
await page.mouse.click(800, 640);
await page.waitForTimeout(200);

// ---- 4. deletion model -------------------------------------------------------
await page.evaluate(() => {
  const doc = window.__sowerDoc;
  const track = doc.score.tracks[0];
  const bar = doc.score.bars[4];
  const mk = (pitch, str, fret, start, dur) => ({ pitch, start, duration: dur, string: str, fret });
  doc.execute({ type: "addNote", trackId: track.id, barId: bar.id, note: mk(64, 0, 0, 0, 240) });
  doc.execute({ type: "addNote", trackId: track.id, barId: bar.id, note: mk(59, 1, 0, 0, 240) });
  doc.execute({ type: "addNote", trackId: track.id, barId: bar.id, note: mk(62, 0, 2, 960, 240) });
});
await page.waitForTimeout(450); // let the layout re-render before hit-testing
const colPoint = await page.evaluate(() =>
  window.__sowerRenderer.pointFor({ barIndex: 4, tick: 0, stringIndex: 0 }),
);
await page.mouse.click(colPoint.x, colPoint.y);
await page.waitForTimeout(150);
const caretInfo = await page.evaluate(() => document.querySelector(".status-bar span")?.textContent);
await page.keyboard.press("Delete");
await page.waitForTimeout(250);
const afterDel = await page.evaluate(() =>
  window.__sowerDoc.score.bars[4].voices[0].notes.map((n) => ({ start: n.start })),
);
check(
  "Del removes the whole beat group (all strings at the position)",
  afterDel.length === 1 && afterDel[0].start === 960,
  `caret=${JSON.stringify(caretInfo)} notes=${JSON.stringify(afterDel)}`,
);
// the rest that appeared is deletable: Backspace on it pulls the note into place
await page.keyboard.press("Backspace");
await page.waitForTimeout(250);
const afterRestDel = await page.evaluate(() =>
  window.__sowerDoc.score.bars[4].voices[0].notes.map((n) => ({ start: n.start })),
);
check(
  "deleting the rest pulls the next notes into place (ripple)",
  afterRestDel.length === 1 && afterRestDel[0].start === 0,
  JSON.stringify(afterRestDel),
);

console.log("\n--- RESULTS ---");
for (const line of [...PASS, ...FAIL]) console.log(line);
console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
await browser.close();
if (FAIL.length > 0) process.exit(1);
