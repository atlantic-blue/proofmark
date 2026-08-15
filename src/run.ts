#!/usr/bin/env -S node --experimental-strip-types
/**
 * The entry point. One product in, the competition's distribution picture out.
 *
 *   node --experimental-strip-types src/run.ts products/hush-log.json
 *
 * Stages run in order because each needs the one before it: rivals come from the
 * product's search terms, advertiser identities come from the rival names, and
 * the advertisements come from the advertiser identities.
 *
 * Browser work is sequential on purpose. Several driven browsers at once against
 * one host reads as an attack and gets the address blocked, which costs far more
 * than the time it saves.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectReviews, discoverRivals, lookupApp } from "./apple.ts";
import { readAdDetailBodies, readTexts, render } from "./browser.ts";
import { busiestEuMarket, readMarketSweep, WORLD_MARKETS } from "./markets.ts";
import { parseAdDetail } from "./adDetail.ts";
import {
  activeAdvertiserPageUrl,
  advertiserPageUrl,
  brandOf,
  keywordSearchUrl,
  matchAdvertiser,
  parseAds,
  parseAdvertiserCensus,
  rankHooks,
  META,
} from "./meta.ts";
import { readPresence } from "./platforms.ts";
import { buildReport } from "./report.ts";
import { buildIndex, buildSite } from "./site.ts";
import { buildRivalPage, rivalPagePath } from "./rivalPage.ts";
import { summariseVoice } from "./voice.ts";
import type {
  Ad,
  AdDetail,
  Advertiser,
  DistributionPicture,
  MarketReading,
  PlatformPresence,
  Product,
  VoiceOfCustomer,
} from "./types.ts";

/** How many rivals get the expensive treatment: a library search and a review sweep. */
const DEEP_RIVALS = 6;

/**
 * How many matched rivals get counted market by market. Each one costs a page
 * load per market, so this is the slowest stage in the pipeline and the number
 * is a budget rather than a preference. Anything above it is named in the gaps
 * rather than dropped quietly.
 */
const SWEEP_ADVERTISERS = 4;

/**
 * How many of an advertiser's advertisements get their audience read. Each one
 * is a request, and the library refuses a caller that asks too fast, so this is
 * a budget. What it leaves out is named in the gaps.
 */
const DETAIL_ADS = 10;

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function validateProduct(value: unknown): Product {
  const product = value as Partial<Product>;
  const missing = (["productId", "name", "job", "market", "storeEntity"] as const).filter(
    (key) => typeof product[key] !== "string" || product[key] === "",
  );
  if (missing.length > 0) throw new Error(`product file is missing: ${missing.join(", ")}`);
  if (!Array.isArray(product.searchTerms) || product.searchTerms.length === 0) {
    throw new Error("product file needs at least one search term, or nothing can be discovered");
  }
  if (!Array.isArray(product.brandTerms)) {
    throw new Error("product file needs brandTerms, or the product lists itself as its own rival");
  }
  return product as Product;
}

/**
 * Which matched rivals get counted market by market, and which are named as
 * skipped.
 *
 * Exported because the alternative is untested. The first version of the sweep
 * ran on `advertisers[0]`, which put a rival that advertises nowhere on the
 * published page and left the one with a thirty market campaign unread. A
 * mutation back to a single advertiser has to turn a test red, and nothing
 * inside `main` can be reached to do that.
 */
export function planSweep(
  advertisers: readonly Advertiser[],
  limit: number,
): { swept: Advertiser[]; skipped: Advertiser[] } {
  return { swept: advertisers.slice(0, limit), skipped: advertisers.slice(limit) };
}

/**
 * One page per rival that has an advertiser account, written beside the product
 * page so the link is a folder away and needs no server.
 */
async function writeRivalPages(picture: DistributionPicture, outputDir: string): Promise<number> {
  const matched = new Set(picture.advertisers.map((advertiser) => advertiser.rivalId));
  let written = 0;
  for (const rival of picture.rivals) {
    if (!matched.has(rival.rivalId)) continue;
    const dir = join(outputDir, rivalPagePath(rival));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), buildRivalPage(picture, rival), "utf8");
    written += 1;
  }
  return written;
}

/**
 * Rebuilds the landing page from every report already on disk, so publishing one
 * product never drops the others off the front page.
 */
async function writeSiteIndex(): Promise<void> {
  const entries = await readdir("out", { withFileTypes: true }).catch(() => []);
  const products: { productId: string; name: string; readAt: string; ads: number }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const saved = JSON.parse(
        await readFile(join("out", entry.name, "picture.json"), "utf8"),
      ) as DistributionPicture;
      products.push({
        productId: entry.name,
        name: saved.product.name,
        readAt: saved.readAt,
        ads: saved.ads.length,
      });
    } catch {
      // A folder with no picture is not a report, so it is not listed.
    }
  }

  products.sort((left, right) => left.name.localeCompare(right.name));
  await writeFile(join("out", "index.html"), buildIndex(products), "utf8");
}

async function main(): Promise<void> {
  const productPath = process.argv[2];
  if (!productPath) {
    console.error("usage: run.ts <products/name.json>");
    process.exitCode = 1;
    return;
  }

  const product = validateProduct(JSON.parse(await readFile(productPath, "utf8")));
  const outputDir = join("out", product.productId);
  await mkdir(outputDir, { recursive: true });

  /**
   * Rewrites the report from the picture already on disk. Wording changes to the
   * report must not cost another hour of driven browsers, and re-reading a
   * library to fix a sentence is also rude to the host.
   */
  if (process.argv.includes("--report-only")) {
    const saved = JSON.parse(
      await readFile(join(outputDir, "picture.json"), "utf8"),
    ) as DistributionPicture;
    await writeFile(join(outputDir, "REPORT.md"), buildReport(saved), "utf8");
    await writeFile(join(outputDir, "index.html"), buildSite(saved), "utf8");
    await writeRivalPages(saved, outputDir);
    await writeSiteIndex();
    log(`rewrote ${outputDir} from the picture read on ${saved.readAt.slice(0, 10)}`);
    return;
  }

  const gaps: string[] = [];

  log(`\n== ${product.name}: discovering rivals from ${product.searchTerms.length} search terms`);
  const rivals = await discoverRivals(product);
  if (rivals.length === 0) {
    throw new Error("no rivals found: the search terms return nothing, so nothing downstream can run");
  }
  log(`   ${rivals.length} rivals. Closest: ${rivals.slice(0, 5).map((rival) => rival.name).join(", ")}`);

  const deep = rivals.slice(0, DEEP_RIVALS);

  log(`\n== reading the advertisement library for ${product.searchTerms.length} category terms`);
  const categoryAdvertisers: {
    platform: typeof META;
    term: string;
    name: string;
    advertiserId: string;
    count: number;
  }[] = [];
  const censusByTerm = new Map<string, ReturnType<typeof parseAdvertiserCensus>>();
  for (const term of product.searchTerms) {
    const result = await render(keywordSearchUrl(term, product.market), { scrolls: 3 });
    const census = parseAdvertiserCensus(result.captures);
    censusByTerm.set(term, census);
    for (const entry of census) {
      categoryAdvertisers.push({ platform: META, term, ...entry });
    }
    log(`   "${term}": ${census.length} advertisers`);
  }

  log(`\n== matching the ${deep.length} closest rivals to advertiser accounts`);
  const everyCensus = [...censusByTerm.values()].flat();
  const advertisers: Advertiser[] = [];
  for (const rival of deep) {
    let match = matchAdvertiser(rival.name, everyCensus);
    if (!match) {
      const branded = await render(
        keywordSearchUrl(brandOf(rival.name), product.market, { activeOnly: false }),
        { scrolls: 2 },
      );
      match = matchAdvertiser(rival.name, parseAdvertiserCensus(branded.captures));
    }
    if (!match) {
      gaps.push(`${rival.name} could not be matched to an advertiser account on Meta.`);
      log(`   ${rival.name}: no match`);
      continue;
    }
    advertisers.push({
      platform: META,
      advertiserId: match.advertiserId,
      rivalId: rival.rivalId,
      name: match.name,
      matchConfidence: match.confidence,
      activeAdCountAtLeast: match.count,
    });
    log(`   ${rival.name} -> ${match.name} (${match.confidence})`);
  }

  log(`\n== reading the advertisements of ${advertisers.length} matched advertisers`);
  const ads: Ad[] = [];
  for (const advertiser of advertisers) {
    const result = await render(advertiserPageUrl(advertiser.advertiserId, product.market), {
      scrolls: 8,
    });
    const parsed = parseAds(result.text, new Date(), result.html).map((ad) => ({ ...ad, advertiserId: advertiser.advertiserId }));
    ads.push(...parsed);
    log(`   ${advertiser.name}: ${parsed.length} advertisements`);
  }
  if (ads.length === 0) {
    gaps.push("No advertisement copy was captured for any rival, so no hook could be ranked.");
  }

  /**
   * Every matched rival is swept, not only the closest one.
   *
   * The first version swept `advertisers[0]` to keep the slowest stage cheap.
   * That put SnoreLab on the published report, and SnoreLab is dark in all forty
   * markets, so the geography section said nothing while ShutEye's thirty market
   * campaign sat one place further down the list and was never read. A
   * comparison of one rival is not a comparison.
   */
  const worldMarkets = product.worldMarkets ?? WORLD_MARKETS;
  const { swept, skipped } = planSweep(advertisers, SWEEP_ADVERTISERS);
  const marketSweep: MarketReading[] = [];
  if (swept.length === 0) {
    gaps.push("No rival was matched to an advertiser account, so no market sweep could be run.");
  }
  if (skipped.length > 0) {
    gaps.push(
      `The market sweep covers the ${swept.length} closest matched rivals. ` +
        `Not swept: ${skipped.map((advertiser) => advertiser.name).join(", ")}.`,
    );
  }
  for (const advertiser of swept) {
    const rival = rivals.find((entry) => entry.rivalId === advertiser.rivalId);
    log(`\n== counting ${advertiser.name} in ${worldMarkets.length} markets`);
    const readings = await readMarketSweep(
      { readTexts, lookupApp },
      {
        advertiserId: advertiser.advertiserId,
        appleAppId: rival?.appleAppId ?? null,
        markets: worldMarkets,
        onMarket: (reading) =>
          log(
            `   ${reading.market}: ${reading.liveAds === null ? "unread" : `${reading.liveAds} live`}` +
              `, ${reading.ratings === null ? "ratings not published" : `${reading.ratings.toLocaleString("en-GB")} ratings`}`,
          ),
      },
    );
    marketSweep.push(...readings);
    const unread = readings.filter((reading) => reading.liveAds === null).map((reading) => reading.market);
    if (unread.length > 0) {
      gaps.push(
        `${advertiser.name}: the advertisement count could not be read in ${unread.length} markets: ${unread.join(", ")}.`,
      );
    }
  }

  /**
   * The audience behind each advertisement: how many people it reached, which
   * ages and genders it actually landed on, and who paid for it.
   *
   * Read from a market inside the European Union, because that is the only place
   * the numbers are published. An advertiser running nothing in the Union has no
   * audience to read, and asking somewhere else would return a card with no
   * audience at all rather than an error.
   */
  const adDetails: AdDetail[] = [];
  for (const advertiser of swept) {
    const market = busiestEuMarket(marketSweep, advertiser.advertiserId);
    if (!market) {
      gaps.push(
        `${advertiser.name} runs nothing in the European Union, so no reach, age or gender is published for them anywhere.`,
      );
      continue;
    }
    const theirAds = ads
      .filter((ad) => ad.advertiserId === advertiser.advertiserId)
      .slice(0, DETAIL_ADS);
    if (theirAds.length === 0) continue;

    log(`\n== reading the audience of ${theirAds.length} ${advertiser.name} advertisements, from ${market}`);
    const bodies = await readAdDetailBodies(
      activeAdvertiserPageUrl(advertiser.advertiserId, market),
      theirAds.map((ad) => ad.libraryId),
    ).catch((error: unknown) => {
      gaps.push(`${advertiser.name}: the audience could not be read (${(error as Error).message}).`);
      return new Map<string, string | null>();
    });

    let refused = 0;
    for (const [libraryId, body] of bodies) {
      const detail = body === null ? null : parseAdDetail(body, libraryId);
      if (!detail) {
        refused += 1;
        continue;
      }
      adDetails.push(detail);
      log(
        `   ${libraryId}: reach ${detail.euTotalReach?.toLocaleString("en-GB") ?? "not published"}` +
          `, targeted ${detail.targetedAgeMin ?? "?"} to ${detail.targetedAgeMax ?? "?"} ${detail.targetedGender ?? ""}`,
      );
    }
    if (refused > 0) {
      gaps.push(`${advertiser.name}: the audience was refused for ${refused} of ${bodies.size} advertisements read.`);
    }
  }

  log(`\n== reading ${deep.length} rival websites for platform presence`);
  const presence: PlatformPresence[] = [];
  for (const rival of deep) {
    if (!rival.domain) {
      gaps.push(`${rival.name} lists no website, so its platform presence could not be read.`);
      continue;
    }
    const read = await readPresence(rival.rivalId, rival.domain);
    presence.push(read);
    log(`   ${rival.name}: ${read.advertisingPlatforms.join(", ") || "nothing found"}`);
  }

  log(`\n== collecting reviews for ${deep.length} rivals`);
  const voice: VoiceOfCustomer[] = [];
  for (const rival of deep) {
    const reviews = await collectReviews(rival.appleAppId, product.market);
    if (reviews.length === 0) {
      gaps.push(`${rival.name} has no reviews in the ${product.market.toUpperCase()} store.`);
      continue;
    }
    const summary = summariseVoice(rival.rivalId, reviews);
    voice.push(summary);
    log(`   ${rival.name}: ${summary.reviewsRead} read, ${summary.lowReviews} at one or two stars`);
  }

  gaps.push("Apple Search Ads publishes no library, so no rival's use of it can be confirmed or denied.");
  gaps.push("Only Meta was read. Google, TikTok and LinkedIn libraries are not wired in yet.");

  const picture: DistributionPicture = {
    product,
    readAt: new Date().toISOString(),
    rivals,
    advertisers,
    ads,
    hooks: rankHooks(ads),
    presence,
    voice,
    categoryAdvertisers,
    marketSweep,
    adDetails,
    gaps,
  };

  await writeFile(join(outputDir, "picture.json"), JSON.stringify(picture, null, 1), "utf8");
  await writeFile(join(outputDir, "REPORT.md"), buildReport(picture), "utf8");
  await writeFile(join(outputDir, "index.html"), buildSite(picture), "utf8");
  await writeRivalPages(picture, outputDir);
  await writeSiteIndex();

  log(`\nwrote ${outputDir}: REPORT.md, index.html and picture.json`);
}

/**
 * Only run when this file is the entry point. Importing it from a test must not
 * start a browser, and must not call process.exit, which would end the test run
 * early and report a pass for tests that never executed.
 */
if (process.argv[1]?.endsWith("run.ts")) {
  await main();
  process.exit(0);
}
