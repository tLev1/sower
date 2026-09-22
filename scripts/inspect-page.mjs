import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:5173";
const consoleLogs = [];
const pageErrors = [];
const failedRequests = [];

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

page.on("console", (msg) => {
  consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
});
page.on("pageerror", (err) => {
  pageErrors.push(err.stack ?? err.message);
});
page.on("requestfailed", (req) => {
  failedRequests.push(`${req.url()} -> ${req.failure()?.errorText}`);
});
page.on("response", (res) => {
  if (res.status() >= 400) failedRequests.push(`${res.url()} -> HTTP ${res.status()}`);
});

await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(4000);

const domInfo = await page.evaluate(() => {
  const container = document.querySelector(".score-scroll");
  const svg = container?.querySelectorAll("svg").length ?? 0;
  const children = container ? [...container.children].map((c) => `${c.tagName}.${c.className}`) : [];
  const alphaTabApiKeys = container ? Object.keys(container).filter((k) => k.toLowerCase().includes("alpha")) : [];
  return {
    hasContainer: !!container,
    containerChildren: children,
    svgCount: svg,
    htmlSnippet: container ? container.innerHTML.slice(0, 600) : "(no container)",
    alphaTabApiKeys,
    bodyText: document.body.innerText.slice(0, 200),
  };
});

await page.screenshot({ path: "C:/dev/temp/opencode/page.png", fullPage: true });
await browser.close();

console.log("=== DOM INFO ===");
console.log(JSON.stringify(domInfo, null, 2));
console.log("=== PAGE ERRORS ===");
console.log(pageErrors.join("\n\n") || "(none)");
console.log("=== FAILED REQUESTS ===");
console.log(failedRequests.join("\n") || "(none)");
console.log("=== CONSOLE (errors/warnings) ===");
console.log(consoleLogs.filter((l) => l.startsWith("[error]") || l.startsWith("[warning]")).join("\n") || "(none)");
console.log("=== CONSOLE (all, first 30) ===");
console.log(consoleLogs.slice(0, 30).join("\n"));
