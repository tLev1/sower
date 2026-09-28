import { chromium } from "playwright";

/**
 * Phase 1c.3 — keyboard shortcuts configuration:
 *  1. the panel lists every registered shortcut, grouped
 *  2. click-to-rebind records a new chord and persists it
 *  3. the new binding drives the editor and the old one stops firing
 *  4. binding an already-used chord is refused with a visible conflict
 *  5. per-row reset and reset-all restore the defaults
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

const panelOpen = () =>
  page.evaluate(() => document.querySelector(".settings-panel") !== null);
const rows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".settings-row")].map((r) => ({
      label: r.querySelector(".settings-label")?.textContent ?? "",
      key: r.querySelector(".settings-key")?.textContent ?? "",
    })),
  );
const bindingFor = (label) =>
  page.evaluate(
    (l) =>
      [...document.querySelectorAll(".settings-row")]
        .find((r) => r.querySelector(".settings-label")?.textContent === l)
        ?.querySelector(".settings-key")?.textContent ?? "",
    label,
  );
const clickRowKey = async (label) => {
  await page.evaluate((l) => {
    const row = [...document.querySelectorAll(".settings-row")].find(
      (r) => r.querySelector(".settings-label")?.textContent === l,
    );
    row?.querySelector(".settings-key")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, label);
  await page.waitForTimeout(150);
  return bindingFor(label);
};

// ---- 1. open the panel -----------------------------------------------------
await page.locator(".tool-btn", { hasText: "Keys" }).click();
await page.waitForTimeout(300);
check("the Keys button opens the shortcuts panel", (await panelOpen()) === true);
const all = await rows();
console.log("rows:", all.length);
check("every registered shortcut is listed", all.length >= 25, `${all.length} rows`);
const groups = await page.evaluate(() =>
  [...document.querySelectorAll(".settings-group h3")].map((h) => h.textContent ?? ""),
);
check(
  "shortcuts are grouped",
  groups.includes("Note entry") && groups.includes("Editing") && groups.includes("Transport"),
  groups.join(", "),
);
check(
  "the default bindings are shown",
  (await bindingFor("Write a rest")) === "B" && (await bindingFor("Undo")) === "Ctrl+Z",
  `rest=${await bindingFor("Write a rest")} undo=${await bindingFor("Undo")}`,
);

// ---- 2. rebind "Write a rest" to N ----------------------------------------
const recording = await clickRowKey("Write a rest");
check("clicking a key enters recording mode", recording.includes("Press a key"), recording);
await page.keyboard.press("KeyN");
await page.waitForTimeout(300);
const rebound = await bindingFor("Write a rest");
check("pressing a key records the new binding", rebound === "N", rebound);
const stored = await page.evaluate(() => localStorage.getItem("sower.shortcuts.v1") ?? "");
check("the rebind is persisted", stored.includes('"entry.rest":"N"'), stored);

// ---- 3. the new binding drives the editor ---------------------------------
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
const before = await page.evaluate(() => window.__sowerDoc.score.bars[0].voices[0].rests ?? []);
await page.locator(".settings-actions .tool-btn", { hasText: "Close" }).click();
await page.waitForTimeout(250);
// caret is at bar 1 / step 1 — N should now write a rest there
await page.keyboard.press("KeyN");
await page.waitForTimeout(350);
const after = await page.evaluate(() => window.__sowerDoc.score.bars[0].voices[0].rests ?? []);
check("the rebound key writes a rest", after.length > before.length, `${before.length} -> ${after.length}`);

// ---- 4. the old binding stops firing --------------------------------------
await page.evaluate(() => {
  const doc = window.__sowerDoc;
  const s = doc.score;
  for (const r of [...(s.bars[0].voices[0].rests ?? [])]) {
    doc.execute({ type: "removeRange", trackId: s.tracks[0].id, barId: s.bars[0].id, start: r.start, duration: r.duration });
  }
});
await page.waitForTimeout(250);
await page.keyboard.press("KeyB");
await page.waitForTimeout(300);
const afterOld = await page.evaluate(() => window.__sowerDoc.score.bars[0].voices[0].rests ?? []);
check("the old binding no longer fires", afterOld.length === 0, `${afterOld.length} rests`);

// ---- 5. conflicts are refused ---------------------------------------------
await page.locator(".tool-btn", { hasText: "Keys" }).click();
await page.waitForTimeout(250);
await clickRowKey("Ghost note");
await page.keyboard.press("KeyN"); // already bound to "Write a rest"
await page.waitForTimeout(250);
const error = await page.evaluate(() => document.querySelector(".settings-error")?.textContent ?? "");
const storedAfterConflict = await page.evaluate(() => localStorage.getItem("sower.shortcuts.v1") ?? "");
check(
  "a conflicting chord is refused and reported",
  error.includes("already bound to Write a rest") && !storedAfterConflict.includes("artic.ghost"),
  `${error} | stored=${storedAfterConflict}`,
);
// the row is still recording so the user can try another chord
const stillRecording = await bindingFor("Ghost note");
check("the row stays in recording mode after a clash", stillRecording.includes("Press a key"), stillRecording);
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

// ---- 6. per-row + global reset --------------------------------------------
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
await page.evaluate(() => {
  const row = [...document.querySelectorAll(".settings-row")].find(
    (r) => r.querySelector(".settings-label")?.textContent === "Write a rest",
  );
  row?.querySelector(".settings-reset")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(250);
check("per-row reset restores the default", (await bindingFor("Write a rest")) === "B", await bindingFor("Write a rest"));

// rebind something, then reset everything
await clickRowKey("Palm mute");
await page.keyboard.press("KeyU");
await page.waitForTimeout(250);
check("another rebind lands", (await bindingFor("Palm mute")) === "U", await bindingFor("Palm mute"));
await page.locator(".settings-actions .tool-btn", { hasText: "Reset all" }).click();
await page.waitForTimeout(250);
const cleared = await page.evaluate(() => localStorage.getItem("sower.shortcuts.v1") ?? "");
check(
  "reset all restores every default and clears storage",
  (await bindingFor("Palm mute")) === "M" && (cleared === "" || cleared === "{}"),
  `palmMute=${await bindingFor("Palm mute")} stored=${cleared}`,
);

// ---- 7. rebinds survive a reload ------------------------------------------
await clickRowKey("Staccato");
await page.keyboard.press("KeyT");
await page.waitForTimeout(250);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2200);
await page.locator(".tool-btn", { hasText: "Keys" }).click();
await page.waitForTimeout(300);
check("rebinds survive a reload", (await bindingFor("Staccato")) === "T", await bindingFor("Staccato"));

console.log("\n" + PASS.concat(FAIL).join("\n"));
console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
await browser.close();
if (FAIL.length > 0) process.exit(1);
