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
  readonly html: string;
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

/**
 * Reads the rendered text of many addresses through one browser and one tab.
 *
 * A sweep across forty markets is forty page loads, and launching Chrome forty
 * times costs more than the loads do. Nothing is scrolled, because the caller
 * wants the header count rather than the cards, and images, video and fonts are
 * refused because they are most of the bytes and none of the answer.
 *
 * Still one page at a time. Several driven browsers at once against one host
 * reads as an attack.
 */
export async function readTexts(
  urls: readonly string[],
  options: { readonly waitFor?: RegExp; readonly settleMs?: number; readonly gapMs?: number } = {},
): Promise<(string | null)[]> {
  const waitFor = options.waitFor ?? /results|No ads match your search criteria/i;
  const settleMs = options.settleMs ?? 1500;
  const gapMs = options.gapMs ?? 1200;

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    defaultViewport: { width: 1440, height: 1200 },
  });

  const texts: (string | null)[] = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const kind = request.resourceType();
      const decision = kind === "image" || kind === "media" || kind === "font" ? request.abort() : request.continue();
      decision.catch(() => {
        // A request that was already handled is not a finding.
      });
    });

    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        // The count arrives after the first results call, and the network on
        // this page never goes quiet, so wait for the words rather than for
        // idleness.
        await page
          .waitForFunction(
            (pattern: string) => new RegExp(pattern, "i").test(document.body.innerText),
            { timeout: 30_000 },
            waitFor.source,
          )
          .catch(() => {
            // A market that never shows a count is recorded as unread below.
          });
        await sleep(settleMs);
        texts.push(await page.evaluate(() => document.body.innerText));
      } catch {
        texts.push(null);
      }
      await sleep(gapMs);
    }
  } finally {
    await Promise.race([browser.close(), sleep(10_000)]);
  }

  return texts;
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
    const html = await page.content();
    return { url, text, html, captures };
  } finally {
    await Promise.race([browser.close(), sleep(10_000)]);
  }
}
