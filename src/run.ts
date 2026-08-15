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
import { readTexts, render } from "./browser.ts";
import { readMarketSweep, WORLD_MARKETS } from "./markets.ts";
import {
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
import { summariseVoice } from "./voice.ts";
import type {
  Ad,
  Advertiser,
  DistributionPicture,
  MarketReading,
  PlatformPresence,
  Product,
  VoiceOfCustomer,
} from "./types.ts";

/** How many rivals get the expensive treatment: a library search and a review sweep. */
const DEEP_RIVALS = 6;

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
   * The sweep covers the closest matched rival only. It is one page load per
   * market, so running it for every rival would multiply the slowest stage in
   * the pipeline by six for a question one rival answers.
   */
  const worldMarkets = product.worldMarkets ?? WORLD_MARKETS;
  const lead = advertisers[0];
  let marketSweep: MarketReading[] = [];
  if (!lead) {
    gaps.push("No rival was matched to an advertiser account, so no market sweep could be run.");
  } else {
    const leadRival = rivals.find((rival) => rival.rivalId === lead.rivalId);
    log(`\n== counting ${lead.name} in ${worldMarkets.length} markets`);
    marketSweep = await readMarketSweep(
      { readTexts, lookupApp },
      {
        advertiserId: lead.advertiserId,
        appleAppId: leadRival?.appleAppId ?? null,
        markets: worldMarkets,
        onMarket: (reading) =>
          log(
            `   ${reading.market}: ${reading.liveAds === null ? "unread" : `${reading.liveAds} live`}` +
              `, ${reading.ratings === null ? "ratings not published" : `${reading.ratings.toLocaleString("en-GB")} ratings`}`,
          ),
      },
    );
    const unread = marketSweep.filter((reading) => reading.liveAds === null).map((reading) => reading.market);
    if (unread.length > 0) {
      gaps.push(`The advertisement count could not be read in ${unread.length} markets: ${unread.join(", ")}.`);
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
    gaps,
  };

  await writeFile(join(outputDir, "picture.json"), JSON.stringify(picture, null, 1), "utf8");
  await writeFile(join(outputDir, "REPORT.md"), buildReport(picture), "utf8");
  await writeFile(join(outputDir, "index.html"), buildSite(picture), "utf8");
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
