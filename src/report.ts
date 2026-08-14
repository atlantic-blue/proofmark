/**
 * Turns a distribution picture into the document a human reads.
 *
 * The order is deliberate. Price model first, because how a category sells is a
 * distribution fact and it decides whether any advertisement can work. Then
 * where the money goes, then what they say, then who else is bidding, then what
 * their customers are angry about. Gaps last and never hidden.
 */

import type { DistributionPicture } from "./types.ts";

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
          `Apple publishes no rating count for ${withheld} of these ${rivals.length} rivals, so size`,
          "is not measured for them. That is a withheld number, not a low one: CleanMyMac reports no",
          "rating count and serves 500 reviews. The review counts further down are the closest",
          "measure available.",
        ];

  const verdict =
    paid === 0
      ? "Every rival found is free to install. A paid product in this category is asking its " +
        "advertising to convert a payment where every rival only has to convert a tap."
      : `${free} of ${rivals.length} rivals are free to install and ${paid} charge up front.`;

  return line([
    "## How the category sells",
    "",
    verdict,
    "",
    ...rows,
    ...ratingsNote,
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
      `- ${advertiser.name} on ${advertiser.platform}: at least ${advertiser.activeAdCountAtLeast} ` +
      `active advertisements, match ${advertiser.matchConfidence}.`,
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
    const runLength = hook.longestRunDays === null ? "unknown" : `${hook.longestRunDays} days`;
    return line([
      `- **${hook.creatives} creatives**, ${hook.runs} runs, longest run ${runLength}, ${window}` +
        `${hook.stillRunning ? ", still running" : ", all ended"}`,
      `  ${hook.advertiser}: "${hook.copy}"`,
    ]);
  });

  return line([
    "## What they say, ranked by what they put behind it",
    "",
    "Ranked by how many creatives share one piece of copy, not by how long an advertisement ran.",
    "In a seasonal category nobody runs a long advertisement, so length of run ranks nothing. What",
    "a company repeats is the sentence.",
    "",
    ...rows,
  ]);
}

function whoElseBids(picture: DistributionPicture): string {
  if (picture.categoryAdvertisers.length === 0) {
    return line(["## Who else bids on these words", "", "No advertiser census was captured."]);
  }

  const byTerm = new Map<string, typeof picture.categoryAdvertisers>();
  for (const entry of picture.categoryAdvertisers) {
    const list = byTerm.get(entry.term) ?? [];
    byTerm.set(entry.term, [...list, entry]);
  }

  const blocks: string[] = [];
  for (const [term, entries] of byTerm) {
    const top = [...entries].sort((left, right) => right.count - left.count).slice(0, 10);
    blocks.push(`**"${term}"**: ${entries.length} advertisers. Largest:`);
    blocks.push(...top.map((entry) => `  - ${entry.count} advertisements, ${entry.name}`));
    blocks.push("");
  }

  return line([
    "## Who else bids on these words",
    "",
    "Every advertiser the library reports against the product's own search terms. The count",
    "saturates at ten, so ten means ten or more. An absent rival is a finding too.",
    "",
    ...blocks,
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
    priceModel(picture),
    "",
    whereTheyBuy(picture),
    "",
    whatTheySay(picture),
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
