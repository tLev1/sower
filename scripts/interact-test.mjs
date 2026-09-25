import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:5173";
const logs = [];
const pageErrors = [];

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => pageErrors.push(err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") logs.push(msg.text());
});

await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);

const statusText = async () =>
  (await page.locator(".status-bar").innerText()).split("\n")[0];

const results = {};

// helper: client-space pixel position of a (bar, step, string) in the TAB
const tabPoint = (barIndex, tick, stringVisual) =>
  page.evaluate(
    ({ barIndex, tick, stringVisual }) => {
      const r = window.__sowerRenderer;
      const p = r.pointFor({ barIndex, tick, stringIndex: stringVisual });
      return p;
    },
    { barIndex, tick, stringVisual },
  );

// 1. click directly on the first TAB number (bar 1, step 1, high E = string 0)
const p1 = await tabPoint(0, 0, 0);
await page.mouse.click(p1.x, p1.y);
await page.waitForTimeout(300);
results.clickOnNote = { status: await statusText() }; // expect Bar 1 · String 1 · Step 1

// 2. click an EMPTY string line (string 4) at step 3 of bar 1
const p2 = await tabPoint(0, 480, 4);
await page.mouse.click(p2.x, p2.y);
await page.waitForTimeout(300);
results.clickOnEmptyString = { status: await statusText() }; // expect String 5, Step 3

// 3. chord flow: type 3 (create+advance), ↓ (return), 3 (stay), ↓, 0 (stay)
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(200);
const chordStart = await statusText();
await page.keyboard.press("3"); // creates beat -> auto-advance
await page.waitForTimeout(200);
const afterFirst = await statusText();
await page.keyboard.press("ArrowDown"); // returns to placed tick, next string
await page.waitForTimeout(200);
const afterDown = await statusText();
await page.keyboard.press("3"); // chord tone -> stays
await page.waitForTimeout(200);
const afterSecond = await statusText();
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(150);
await page.keyboard.press("0");
await page.waitForTimeout(300);
const chordEnd = await statusText();
results.chordFlow = { chordStart, afterFirst, afterDown, afterSecond, chordEnd };
results.chordVerdict = {
  firstAdvanced: afterFirst !== chordStart,
  downReturnedToChordTick: afterDown.split("·")[2] === chordStart.split("·")[2],
  chordTonesStayed: afterSecond === afterDown && chordEnd.split("·")[2] === afterDown.split("·")[2],
};

// 4. undo reverts all three chord notes
for (let i = 0; i < 3; i++) {
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
}
results.undoDone = { status: await statusText() };

// 5. empty-beat flow: delete a note, then verify create->advance->down-returns
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const p3 = await tabPoint(0, 0, 0);
await page.mouse.click(p3.x, p3.y);
await page.waitForTimeout(250);
// delete the 4 demo notes at step 1 (strings 0..3)
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(120);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(120);
}
// caret now sits on string 4 at step 1 (empty beat)
await page.keyboard.press("7");
await page.waitForTimeout(300);
const afterCreate = await statusText(); // expect Step 2 (auto-advance on empty beat)
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(250);
const afterDownReturn = await statusText(); // expect back to Step 1, String 6
results.emptyBeatFlow = {
  afterCreate,
  afterDownReturn,
  createAdvanced: afterCreate.includes("Step 2"),
  downReturned: afterDownReturn.includes("Step 1") && afterDownReturn.includes("String 6"),
};

await page.screenshot({ path: "C:/dev/temp/opencode/interact2.png", fullPage: true });
await browser.close();

console.log(JSON.stringify(results, null, 2));
console.log("=== PAGE ERRORS ===");
console.log(pageErrors.join("\n") || "(none)");
console.log("=== CONSOLE ERRORS ===");
console.log(logs.join("\n") || "(none)");
