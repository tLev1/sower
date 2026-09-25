import { chromium } from "playwright";

// Deterministic beam check: inject the Image-1 contour (high, low-middle,
// high) into a fresh bar via the document, then verify the engraver breaks
// the beam (flags appear instead of one beam through the middle head).
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGE ERROR:\n" + (e.stack ?? e.message)));
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);

const counts = () =>
  page.evaluate(() => {
    const s = document.querySelector(".stdb-score-static");
    return {
      flags: [...s.querySelectorAll("text.stdb-flag")].length,
      beams: [...s.querySelectorAll("polygon")].length,
    };
  });

const before = await counts();
await page.evaluate(() => {
  const doc = window.__stdbDoc;
  const track = doc.score.tracks[0];
  doc.execute({ type: "addBar", afterBarId: null });
  const bar = doc.score.bars[doc.score.bars.length - 1];
  const mk = (pitch, str, fret, start) => ({ pitch, start, duration: 240, string: str, fret });
  doc.execute({ type: "addNote", trackId: track.id, barId: bar.id, note: mk(67, 1, 8, 0) });
  doc.execute({ type: "addNote", trackId: track.id, barId: bar.id, note: mk(57, 2, 2, 240) });
  doc.execute({ type: "addNote", trackId: track.id, barId: bar.id, note: mk(67, 1, 8, 480) });
});
await page.waitForTimeout(500);
const after = await counts();
console.log(JSON.stringify({ before, after, deltaFlags: after.flags - before.flags, deltaBeams: after.beams - before.beams }));
await browser.close();
