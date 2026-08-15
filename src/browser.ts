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

/**
 * Fetches the detail response for many advertisements of one advertiser.
 *
 * The numbers are not on the card. They arrive when a reader opens one
 * advertisement, which fires AdLibraryV3AdDetailsQuery. Clicking through every
 * advertisement would be one page interaction each, so instead one real click
 * is performed to capture the request the page makes, and every other
 * advertisement is fetched by replaying that request with a different
 * identifier. The same trick the library's own pagination call taught us.
 *
 * A refusal comes back as null for that advertisement rather than as an empty
 * detail, so a rate limit can never be published as "this advertisement reached
 * nobody".
 */
export async function readAdDetailBodies(
  advertiserPageUrl: string,
  libraryIds: readonly string[],
  options: { readonly gapMs?: number } = {},
): Promise<Map<string, string | null>> {
  const gapMs = options.gapMs ?? 1500;
  const bodies = new Map<string, string | null>();
  if (libraryIds.length === 0) return bodies;

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    defaultViewport: { width: 1440, height: 1600 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    let template: string | null = null;
    page.on("request", (request) => {
      if (template) return;
      const post = request.postData() ?? "";
      if (post.includes("AdLibraryV3AdDetailsQuery")) template = post;
    });

    await page.goto(advertiserPageUrl, { waitUntil: "networkidle2", timeout: 120_000 });
    await sleep(4000);

    // One real mouse click, purely to make the page issue the query so its exact
    // body can be copied. A synthetic click on the label does nothing, because
    // the handler is delegated and wants real coordinates.
    for (const handle of await page.$$("span,div,a")) {
      const label = await handle.evaluate((node) => (node.textContent ?? "").trim());
      if (label !== "See ad details") continue;
      await handle.click().catch(() => {});
      break;
    }
    await sleep(6000);
    if (!template) throw new Error("never saw a detail request to copy");

    for (const libraryId of libraryIds) {
      const body = await page.evaluate(
        async (rawTemplate: string, adArchiveId: string) => {
          const form = new URLSearchParams(rawTemplate);
          const variables = JSON.parse(form.get("variables") ?? "{}");
          variables.adArchiveID = adArchiveId;
          form.set("variables", JSON.stringify(variables));
          const response = await fetch("/api/graphql/", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: form.toString(),
            credentials: "include",
          });
          return await response.text();
        },
        template,
        libraryId,
      );
      bodies.set(libraryId, /Rate limit exceeded|"errors"/.test(body) ? null : body);
      await sleep(gapMs);
    }
  } finally {
    await Promise.race([browser.close(), sleep(10_000)]);
  }

  return bodies;
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
