import { chromium } from "playwright";

/**
 * Player correctness batch:
 *  1. play-from-selection: first note SOUNDS within ~100ms of play (was
 *     delayed by the selection's absolute time — the "offset" bug)
 *  2. note length: notes sound their FULL notated duration on a
 *     pitch-independent sustain ring (alphaTab/SF2 loop semantics), then a
 *     short release; no long ring-over
 *  3. BPM is honored (onset spacing scales with the tempo; live edits too)
 *  4. metronome follows the musical sheet only (beat grid during playback,
 *     silent when the music is stopped)
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

// instrumentation: every source records its absolute audio-clock onset
// (at), the ctx time at scheduling (for the first-sound metric) and stop time
await page.evaluate(() => {
  window.__srcLog = [];
  const origStart = AudioBufferSourceNode.prototype.start;
  const origStop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (...args) {
    const rec = {
      at: args[0],
      ctxNow: this.context.currentTime,
      isClick: (this.buffer?.duration ?? 1) < 0.1,
      bufDur: this.buffer?.duration ?? 0,
      stopAt: null,
    };
    this.__rec = rec;
    window.__srcLog.push(rec);
    return origStart.apply(this, args);
  };
  AudioBufferSourceNode.prototype.stop = function (...args) {
    if (this.__rec) this.__rec.stopAt = typeof args[0] === "number" ? args[0] : this.context.currentTime;
    return origStop.apply(this, args);
  };
  window.__stats = () => {
    const notes = window.__srcLog.filter((s) => !s.isClick);
    const clicks = window.__srcLog.filter((s) => s.isClick);
    const gapsOf = (list) => {
      const t = list.map((s) => s.at).sort((a, b) => a - b);
      return t.slice(1).map((x, i) => x - t[i]);
    };
    return {
      firstLeadMs: notes[0] ? (notes[0].at - notes[0].ctxNow) * 1000 : null,
      refAt: notes[0]?.at ?? null,
      notes: notes.map((s) => ({ on: s.at, off: s.stopAt, bufDur: s.bufDur })),
      noteGaps: gapsOf(notes),
      clickCount: clicks.length,
      clickGaps: gapsOf(clicks),
    };
  };
});

// warm-up (absorbs the one-time headless resume latency)
await page.evaluate(() => window.__sowerRenderer.play());
await page.waitForTimeout(900);
await page.evaluate(() => window.__sowerRenderer.stop());
await page.waitForTimeout(400);

// ---- 1 + 2 + 3. play from bar 2 (~5s into the score at 96 bpm) ---------------
const caret = await page.evaluate(() =>
  window.__sowerRenderer.pointFor({ barIndex: 1, tick: 0, stringIndex: 2 }),
);
await page.mouse.click(caret.x, caret.y);
await page.waitForTimeout(150);
const run1 = await page.evaluate(() => {
  window.__srcLog.length = 0;
  window.__sowerRenderer.play();
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(window.__stats());
      window.__sowerRenderer.stop();
    }, 1600);
  });
});
check(
  "1. first note sounds ~immediately from the selection (offset bug fixed)",
  run1.firstLeadMs !== null && run1.firstLeadMs > 0 && run1.firstLeadMs < 120,
  `first onset ${run1.firstLeadMs?.toFixed(1) ?? "never"}ms after play (was ≈5000ms)`,
);
const gaps1 = run1.noteGaps;
check(
  "3. onset spacing matches the tempo (eighths @96bpm = 312ms)",
  gaps1.length >= 3 && gaps1.every((g) => Math.abs(g - 0.3125) < 0.03),
  `gaps=${gaps1.map((g) => (g * 1000).toFixed(0)).join(",")}ms`,
);
const holds = run1.notes.map((n) => (n.off !== null ? n.off - n.on : null)).filter((h) => h !== null);
check(
  "2. note sounds its full notated length (eighth = 0.31s + short release)",
  holds.length > 0 && holds.every((h) => h > 0.3 && h < 0.6),
  `holds=${holds.map((h) => h.toFixed(2)).join(",")}s`,
);
// alphaTab/SF2-style sustain: every pluck buffer rings ≥1.9s regardless of
// pitch (was pitch-dependent 0.55–3.2s — note length had nothing to do with
// the notation). The looped tail sustains any duration.
const bufDurs = run1.notes.map((n) => n.bufDur);
const sustainOk =
  bufDurs.length > 0 &&
  bufDurs.every((d) => d >= 1.9) &&
  Math.max(...bufDurs) - Math.min(...bufDurs) < 0.1;
check(
  "2b. sustain ring is pitch-independent (all buffers ≥1.9s, loopable)",
  sustainOk,
  `buffers=${bufDurs.map((d) => d.toFixed(2)).join(",")}s`,
);
await page.waitForTimeout(400);

// ---- 3b. 192 bpm must space eighths at 156ms (2x) ---------------------------
await page.fill(".field-input", "192");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const run2 = await page.evaluate(() => {
  window.__srcLog.length = 0;
  window.__sowerRenderer.play();
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(window.__stats());
      window.__sowerRenderer.stop();
    }, 1400);
  });
});
check(
  "3b. tempo 192 honored (eighths = 156ms)",
  run2.noteGaps.length >= 3 && run2.noteGaps.every((g) => Math.abs(g - 0.15625) < 0.03),
  `gaps=${run2.noteGaps.map((g) => (g * 1000).toFixed(0)).join(",")}ms`,
);
await page.waitForTimeout(400);

// ---- 3c. tempo edit applies LIVE during playback -----------------------------
const run3 = await page.evaluate(() => {
  window.__srcLog.length = 0;
  window.__sowerRenderer.play(); // still 192 bpm
  return new Promise((resolve) => {
    setTimeout(() => {
      const bar = window.__sowerDoc.score.bars[1];
      window.__sowerDoc.execute({ type: "setBarTempo", barId: bar.id, tempo: 96, unitTicks: 480 });
    }, 400);
    setTimeout(() => {
      resolve(window.__stats());
      window.__sowerRenderer.stop();
    }, 1900);
  });
});
const lateOn = run3.notes.filter((n) => run3.refAt !== null && n.on - run3.refAt > 1.0);
const lateGaps = lateOn.slice(1).map((n, i) => n.on - lateOn[i].on);
check(
  "3c. tempo edit applies live (onsets slow 156ms → 312ms mid-play)",
  lateGaps.length >= 1 && lateGaps.every((g) => Math.abs(g - 0.3125) < 0.05),
  `late gaps=${lateGaps.map((g) => (g * 1000).toFixed(0)).join(",")}ms`,
);
await page.waitForTimeout(400);

// ---- 4. metronome — follows the sheet only ------------------------------------
await page.fill(".field-input", "96");
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
const silent = await page.evaluate(() => {
  window.__srcLog.length = 0;
  document.querySelector(".metronome-btn").click(); // ON while stopped
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(window.__stats());
      document.querySelector(".metronome-btn").click(); // OFF
    }, 1200);
  });
});
check(
  "4a. metronome stays silent off-playback (follows the sheet, no free-run)",
  silent.clickCount === 0,
  `${silent.clickCount} clicks while stopped (expected 0)`,
);
const grid = await page.evaluate(() => {
  window.__srcLog.length = 0;
  document.querySelector(".metronome-btn").click(); // ON
  window.__sowerRenderer.play();
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(window.__stats());
      window.__sowerRenderer.stop();
      document.querySelector(".metronome-btn").click(); // OFF
    }, 1700);
  });
});
check(
  "4b. metronome clicks on the beat grid during playback (625ms)",
  grid.clickCount >= 2 && grid.clickGaps.every((g) => Math.abs(g - 0.625) < 0.05),
  `count=${grid.clickCount} gaps=${grid.clickGaps.map((g) => (g * 1000).toFixed(0)).join(",")}ms`,
);

// 4c. clicks must continue through trailing rests — all 4 beats of the bar
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
const emptyBar = await page.evaluate(() =>
  window.__sowerRenderer.pointFor({ barIndex: 2, tick: 0, stringIndex: 2 }),
);
await page.mouse.click(emptyBar.x, emptyBar.y);
await page.waitForTimeout(150);
await page.keyboard.press("5"); // one quarter at beat 1 — the rest of the bar is rests
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft"); // caret back to the bar start
await page.waitForTimeout(200);
const restBar = await page.evaluate(() => {
  window.__srcLog.length = 0;
  document.querySelector(".metronome-btn").click(); // ON
  window.__sowerRenderer.play();
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(window.__stats());
      window.__sowerRenderer.stop();
      document.querySelector(".metronome-btn").click(); // OFF
    }, 2800);
  });
});
const restClicks = restBar.clickGaps.map((g) => (g * 1000).toFixed(0));
check(
  "4c. metronome plays ALL beats of the measure (clicks through the rests)",
  restBar.clickCount >= 4 && restBar.clickGaps.every((g) => Math.abs(g - 0.625) < 0.05),
  `count=${restBar.clickCount} gaps=${restClicks.join(",")}ms (4/4 → 4 clicks/bar)`,
);

console.log("\n--- RESULTS ---");
for (const line of [...PASS, ...FAIL]) console.log(line);
console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
await browser.close();
if (FAIL.length > 0) process.exit(1);
