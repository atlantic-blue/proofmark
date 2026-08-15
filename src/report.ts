/**
 * Turns a distribution picture into the document a human reads.
 *
 * The order is deliberate. Geography first, because everything under it is one
 * market deep and the reader has to know which one. Then the price model,
 * because how a category sells decides whether any advertisement can work. Then
 * where the money goes, then what they say, then who else is bidding, then what
 * their customers are angry about. Gaps last and never hidden.
 */

import { byCustomerBase, summariseSweep } from "./markets.ts";
import type { DistributionPicture } from "./types.ts";

/**
 * A report that says "1 advertisements" reads as broken, and a reader who
 * decides the document is broken stops believing the findings in it.
 */
export function plural(count: number, many: string, one: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function line(parts: readonly string[]): string {
  return parts.join("\n");
}

function priceModel(picture: DistributionPicture): string {
  const rivals = picture.rivals;
  const free = rivals.filter((rival) => rival.isFree).length;
  const paid = rivals.length - free;

  /**
   * A rating count of zero means Apple did not publish one, never that nobody
   * rated the application. CleanMyMac reports zero ratings and serves 500
   * reviews in the same breath. So a zero is written as unknown, per rival,
   * because the two kinds sit side by side in one list: the Mac store front
   * withholds the count for some applications and gives it for others.
   */
  const withheld = rivals.filter((rival) => rival.ratingCount === 0).length;

  const rows = rivals.slice(0, 12).map((rival) => {
    const ratings = rival.ratingCount > 0 ? `${rival.ratingCount} ratings` : "ratings not published";
    return `- ${rival.name}: ${rival.formattedPrice || "unknown"}, ${ratings}, updated ${rival.lastUpdated || "unknown"}`;
  });

  const ratingsNote =
    withheld === 0
      ? []
      : [
          "",
          `Apple publishes no rating count for ${plural(withheld, "of these rivals", "of these rivals")},`,
          "so size is not measured for them. That is a withheld number and not a low one, because the",
          "same applications still serve hundreds of reviews. The review counts further down are the",
          "closest measure available.",
        ];

  const verdict =
    paid === 0
      ? "Every rival found is free to install. A paid product in this category is asking its " +
        "advertising to convert a payment where every rival only has to convert a tap."
      : `${free} of ${rivals.length} rivals are free to install. ` +
        `${plural(paid, "charges", "charge")} up front.`;

  return line([
    "## How the category sells",
    "",
    verdict,
    "",
    ...rows,
    ...ratingsNote,
  ]);
}

/**
 * Where the rival sells against where the rival is buying.
 *
 * Written before everything else, because every section under it is one market
 * deep and a reader needs to know which market that is and how much of the
 * rival's world it leaves out.
 */
function whereTheirMarketIs(picture: DistributionPicture): string {
  const sweep = picture.marketSweep ?? [];
  if (sweep.length === 0) {
    return line([
      "## Where their market is",
      "",
      "No market sweep was run, so every finding below describes one country only.",
    ]);
  }

  const summary = summariseSweep(sweep);
  const home = picture.product.market.toUpperCase();
  const homeReading = sweep.find((entry) => entry.market === home);
  const rows = byCustomerBase(sweep)
    .slice(0, 15)
    .map((entry) => {
      const ratings = entry.ratings === null ? "no store listing" : `${entry.ratings.toLocaleString("en-GB")} ratings`;
      const ads = entry.liveAds === null ? "count unread" : entry.liveAds === 0 ? "nothing live" : `${entry.liveAds} live`;
      return `- ${entry.market}: ${ratings}, ${ads}`;
    });

  const homeLine =
    homeReading && homeReading.liveAds !== null
      ? `${home}, the market read in depth below, carries ${plural(homeReading.liveAds, "live advertisements", "live advertisement")}.`
      : `${home} is the market read in depth below.`;

  return line([
    "## Where their market is",
    "",
    `${summary.busiest?.market ?? "No market"} is where they buy hardest, at ${summary.busiest?.liveAds ?? 0} live.`,
    `${summary.largestBase?.market ?? "No market"} holds the most customers, at ` +
      `${(summary.largestBase?.ratings ?? 0).toLocaleString("en-GB")} ratings.`,
    homeLine,
    "",
    `Live advertising in ${summary.marketsWithAds} of ${summary.marketsRead} markets read.`,
    "",
    ...rows,
    "",
    "Neither number is money. An advertisement count counts objects, not budget, and a rating",
    "count is a lifetime total that only rises. The library publishes no spend and no impressions",
    "for a commercial advertiser.",
  ]);
}

function whereTheyBuy(picture: DistributionPicture): string {
  if (picture.presence.length === 0) {
    return line(["## Where they buy", "", "No rival site could be read."]);
  }

  const byRival = new Map(picture.rivals.map((rival) => [rival.rivalId, rival.name]));
  const rows = picture.presence.map((presence) => {
    const name = byRival.get(presence.rivalId) ?? presence.rivalId;
    const ads = presence.advertisingPlatforms.join(", ") || "none found";
    const attribution = presence.attributionProviders.join(", ") || "none found";
    return `- ${name}: advertising ${ads}. Attribution ${attribution}.`;
  });

  const advertiserRows = picture.advertisers.map(
    (advertiser) =>
      `- ${advertiser.name} on ${advertiser.platform}: at least ` +
      `${plural(advertiser.activeAdCountAtLeast, "active advertisements", "active advertisement")}, ` +
      `match ${advertiser.matchConfidence}.`,
  );

  return line([
    "## Where they buy",
    "",
    "Read from each rival's own website and the public tag container behind it. A pixel is not",
    "proof of spend. It is proof that somebody built the measurement, which nobody does for a",
    "platform they never buy on.",
    "",
    ...rows,
    "",
    "Confirmed in the advertisement libraries, which is stronger evidence than a pixel:",
    "",
    ...(advertiserRows.length > 0 ? advertiserRows : ["- No rival was matched to an advertiser account."]),
    "",
    "Two limits worth stating out loud. A site pixel says where a company measures web",
    "conversions, and an application install campaign needs no web pixel at all. And Apple",
    "Search Ads publishes no library, so nothing here can confirm or deny that any rival uses it.",
  ]);
}

function whatTheySay(picture: DistributionPicture): string {
  if (picture.hooks.length === 0) {
    return line(["## What they say", "", "No advertisement copy was captured."]);
  }

  const rows = picture.hooks.slice(0, 12).map((hook) => {
    const window =
      hook.firstSeen && hook.lastSeen ? `${hook.firstSeen} to ${hook.lastSeen}` : "dates not given";
    const runLength = hook.longestRunDays === null ? "unknown" : plural(hook.longestRunDays, "days", "day");
    const copy = hook.copy.length > 0 ? `"${hook.copy}"` : "no caption, the creative carries the message";
    const media = hook.exampleMedia[0];
    return line([
      `- **${plural(hook.creatives, "creatives", "creative")}**, ${plural(hook.runs, "runs", "run")}, ` +
        `longest run ${runLength}, ${window}${hook.stillRunning ? ", still running" : ", all ended"}`,
      `  ${hook.advertiser} (${hook.formats.join(" and ")}): ${copy}`,
      `  See it: ${hook.exampleUrl}${media ? `\n  Creative: ${media}` : ""}`,
    ]);
  });

  return line([
    "## What they say, ranked by what they put behind it",
    "",
    "Ranked by how many creatives share one piece of copy, not by how long an advertisement ran.",
    "In a seasonal category nobody runs a long advertisement, so length of run ranks nothing. What",
    "a company repeats is the sentence.",
    "",
    "Every advertisement links to its permanent page in the library. The creative links come from a",
    "content host and expire, so they are a snapshot taken on the day rather than an archive.",
    "",
    ...rows,
  ]);
}

function throughput(picture: DistributionPicture): string {
  const ads = picture.ads;
  if (ads.length === 0) {
    return line(["## How much they run, and for how long", "", "No advertisements were captured."]);
  }

  const lengths = ads
    .map((ad) => ad.daysLive)
    .filter((days): days is number => days !== null)
    .sort((left, right) => left - right);
  const middle = lengths.length > 0 ? (lengths[Math.floor(lengths.length / 2)] as number) : 0;
  const live = ads.filter((ad) => ad.active).length;
  const totalCreatives = ads.reduce((sum, ad) => sum + ad.creativeShareCount, 0);
  const advertisementDays = lengths.reduce((sum, days) => sum + days, 0);

  const formats = new Map<string, number>();
  for (const ad of ads) formats.set(ad.format, (formats.get(ad.format) ?? 0) + 1);

  const perAdvertiser = new Map<string, { runs: number; creatives: number; days: number; longest: number }>();
  for (const ad of ads) {
    const name = ad.advertiser ?? "unknown";
    const entry = perAdvertiser.get(name) ?? { runs: 0, creatives: 0, days: 0, longest: 0 };
    entry.runs += 1;
    entry.creatives += ad.creativeShareCount;
    entry.days += ad.daysLive ?? 0;
    entry.longest = Math.max(entry.longest, ad.daysLive ?? 0);
    perAdvertiser.set(name, entry);
  }

  const advertiserRows = [...perAdvertiser.entries()]
    .sort((left, right) => right[1].creatives - left[1].creatives)
    .map(
      ([name, entry]) =>
        `- ${name}: ${plural(entry.runs, "runs", "run")}, ${plural(entry.creatives, "creatives", "creative")}, ` +
        `${plural(entry.days, "advertisement days", "advertisement day")} in total, longest ` +
        `${plural(entry.longest, "days", "day")}`,
    );

  return line([
    "## How much they run, and for how long",
    "",
    `${plural(ads.length, "advertisements captured", "advertisement captured")}, carrying ` +
      `${plural(totalCreatives, "creatives", "creative")}. ${plural(live, "are", "is")} still running today.`,
    "",
    lengths.length > 0
      ? `Run length: shortest ${plural(lengths[0] as number, "days", "day")}, middle of the set ` +
        `${plural(middle, "days", "day")}, longest ` +
        `${plural(lengths[lengths.length - 1] as number, "days", "day")}. ` +
        `${plural(advertisementDays, "advertisement days", "advertisement day")} across the set.`
      : "No run length was published for any of them.",
    "",
    `Format: ${[...formats.entries()].map(([name, count]) => `${count} ${name}`).join(", ")}.`,
    "",
    ...advertiserRows,
    "",
    "Placement inside Meta, meaning Facebook against Instagram against Messenger, is shown in the",
    "library only as an icon with no readable label, so it is not captured yet. Reading it needs",
    "the detail page of each advertisement, which is one more page load each.",
  ]);
}

function whoElseBids(picture: DistributionPicture): string {
  if (picture.categoryAdvertisers.length === 0) {
    return line(["## Who else bids on these words", "", "No advertiser census was captured."]);
  }

  /**
   * Raw count buries the finding. A story farm whose copy happens to contain
   * "snore" shows ten advertisements, exactly like a real rival does, and the
   * list then reads as noise.
   *
   * An advertiser that appears under SEVERAL of the product's terms is far more
   * likely to be in the category, by the same reasoning that decides which
   * search results count as rivals. So they lead, and the rest follow.
   */
  const byAdvertiser = new Map<string, { name: string; terms: Set<string>; total: number }>();
  for (const entry of picture.categoryAdvertisers) {
    const seen = byAdvertiser.get(entry.advertiserId) ?? {
      name: entry.name,
      terms: new Set<string>(),
      total: 0,
    };
    seen.terms.add(entry.term);
    seen.total = Math.max(seen.total, entry.count);
    byAdvertiser.set(entry.advertiserId, seen);
  }

  const matched = new Set(picture.advertisers.map((advertiser) => advertiser.advertiserId));
  const ranked = [...byAdvertiser.entries()]
    .map(([advertiserId, seen]) => ({
      advertiserId,
      name: seen.name,
      terms: [...seen.terms].sort(),
      total: seen.total,
      isRival: matched.has(advertiserId),
    }))
    .sort((left, right) => {
      if (right.terms.length !== left.terms.length) return right.terms.length - left.terms.length;
      return right.total - left.total;
    });

  const across = ranked.filter((entry) => entry.terms.length > 1);
  const single = ranked.filter((entry) => entry.terms.length === 1);

  const acrossRows = across
    .slice(0, 15)
    .map(
      (entry) =>
        `- ${entry.name}${entry.isRival ? " (a rival we track)" : ""}: ` +
        `${plural(entry.terms.length, "terms", "term")}, up to ` +
        `${plural(entry.total, "advertisements", "advertisement")}. ${entry.terms.join(", ")}`,
    );

  return line([
    "## Who else bids on these words",
    "",
    `${byAdvertiser.size} advertisers in total across ${new Set(picture.categoryAdvertisers.map((entry) => entry.term)).size} search terms.`,
    "The count saturates at ten, so ten means ten or more. An absent rival is a finding too.",
    "",
    "**Advertisers that appear under more than one of the terms.** These are the ones most likely",
    "to be in the category rather than to have used the word in passing.",
    "",
    ...(acrossRows.length > 0
      ? acrossRows
      : ["- None. No advertiser appeared under more than one term, which is itself worth knowing."]),
    "",
    `**The remaining ${plural(single.length, "advertisers appeared under one term each", "advertiser appeared under one term")}.**`,
    "In consumer categories this tail is usually unrelated: story and drama accounts whose copy",
    "happens to contain the word. Read the full list in picture.json rather than here.",
    "",
  ]);
}

function whatCustomersSay(picture: DistributionPicture): string {
  if (picture.voice.length === 0) {
    return line(["## What their customers are angry about", "", "No reviews were collected."]);
  }

  const byRival = new Map(picture.rivals.map((rival) => [rival.rivalId, rival.name]));
  const totals = new Map<string, number>();
  let lowTotal = 0;

  const blocks: string[] = [];
  for (const voice of picture.voice) {
    if (voice.lowReviews === 0) continue;
    lowTotal += voice.lowReviews;
    const name = byRival.get(voice.rivalId) ?? voice.rivalId;
    const top = voice.themes.slice(0, 4);
    blocks.push(
      `- ${name}: ${voice.lowReviews} reviews at one or two stars out of ${voice.reviewsRead}. ` +
        top.map((theme) => `${theme.name} ${theme.share}%`).join(", "),
    );
    for (const theme of voice.themes) {
      totals.set(theme.name, (totals.get(theme.name) ?? 0) + theme.count);
    }
  }

  const ranked = [...totals.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5);
  const headline =
    ranked.length > 0 && lowTotal > 0
      ? `Across the set there are ${lowTotal} reviews at one or two stars. The largest single ` +
        `theme is "${ranked[0]?.[0]}" at ${ranked[0]?.[1]} of them, which is ` +
        `${Math.round(((ranked[0]?.[1] ?? 0) / lowTotal) * 100)} percent.`
      : "No low star reviews were found.";

  const quoteBlock: string[] = [];
  const leading = ranked[0]?.[0];
  if (leading) {
    quoteBlock.push("", "In their own words:", "");
    for (const voice of picture.voice) {
      const theme = voice.themes.find((candidate) => candidate.name === leading);
      const quote = theme?.quotes[0];
      if (quote) quoteBlock.push(`- ${byRival.get(voice.rivalId) ?? voice.rivalId}: "${quote}"`);
    }
  }

  return line([
    "## What their customers are angry about",
    "",
    headline,
    "",
    ...blocks,
    ...quoteBlock,
  ]);
}

export function buildReport(picture: DistributionPicture): string {
  return line([
    `# ${picture.product.name}: what the competition does for distribution`,
    "",
    `Read on ${picture.readAt.slice(0, 10)} for the ${picture.product.market.toUpperCase()} market.`,
    `Produced by Proofmark from ${picture.product.productId}.json. Every number traces to a request.`,
    "",
    `The product: ${picture.product.job}`,
    "",
    whereTheirMarketIs(picture),
    "",
    priceModel(picture),
    "",
    whereTheyBuy(picture),
    "",
    whatTheySay(picture),
    "",
    throughput(picture),
    "",
    whoElseBids(picture),
    "",
    whatCustomersSay(picture),
    "",
    "## What could not be read",
    "",
    ...(picture.gaps.length > 0 ? picture.gaps.map((gap) => `- ${gap}`) : ["- Nothing was skipped."]),
    "",
  ]);
}
