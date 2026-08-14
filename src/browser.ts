/**
 * Drives a real browser at an advertisement library and returns what the page
 * finally shows plus every response that looked like data.
 *
 * The libraries render with script, so a plain fetch returns an empty shell.
 * Meta answers a headless driven browser with no login at all, which is the
 * single most useful thing this project found.
 *
 * Chrome sometimes never returns from close. The caller's output is already in
 * hand by then, so the close is raced against a timer rather than awaited.
 */

import puppeteer from "puppeteer-core";

const CHROME_PATH =
  process.env["CHROME_PATH"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface RenderResult {
  readonly url: string;
  readonly text: string;
  readonly captures: readonly { url: string; body: string }[];
}

export interface RenderOptions {
  readonly scrolls?: number;
  readonly settleMs?: number;
}

function looksLikeData(contentType: string, url: string): boolean {
  if (url.includes("google-analytics") || url.includes("doubleclick")) return false;
  return contentType.includes("json") || url.includes("graphql") || url.includes("/rpc/");
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function render(url: string, options: RenderOptions = {}): Promise<RenderResult> {
  const scrolls = options.scrolls ?? 8;
  const settleMs = options.settleMs ?? 3000;

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--window-size=1440,2400"],
    defaultViewport: { width: 1440, height: 2400 },
  });

  const captures: { url: string; body: string }[] = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    page.on("response", (response) => {
      const contentType = response.headers()["content-type"] ?? "";
      const responseUrl = response.url();
      if (!looksLikeData(contentType, responseUrl)) return;
      response
        .text()
        .then((body) => {
          if (body.length >= 200) captures.push({ url: responseUrl, body });
        })
        .catch(() => {
          // A response whose body is already gone is not a finding.
        });
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 90_000 });
    await sleep(settleMs);

    for (let index = 0; index < scrolls; index += 1) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(settleMs);
    }

    const text = await page.evaluate(() => document.body.innerText);
    return { url, text, captures };
  } finally {
    await Promise.race([browser.close(), sleep(10_000)]);
  }
}
