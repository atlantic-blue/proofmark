import { test } from "node:test";
import assert from "node:assert/strict";
import { isOurOwnProduct, isRelevant, slugify } from "./apple.ts";
import { findContainerIds, scan } from "./platforms.ts";
import { summariseVoice, themesFor } from "./voice.ts";
import { buildReport } from "./report.ts";
import { validateProduct } from "./run.ts";
import type { DistributionPicture, Product, Review } from "./types.ts";

const PRODUCT: Product = {
  productId: "hush-log",
  name: "Hush Log",
  job: "records and analyses snoring",
  appleAppId: "6759836267",
  market: "gb",
  storeEntity: "software",
  searchTerms: ["snoring"],
  brandTerms: ["hush log", "hushlog"],
};

test("a product is never listed as its own rival, by identifier or by name", () => {
  assert.equal(isOurOwnProduct({ trackId: 6759836267, trackName: "Hush Log" }, PRODUCT), true);
  assert.equal(isOurOwnProduct({ trackId: 1, trackName: "HushLog Pro" }, PRODUCT), true);
  assert.equal(isOurOwnProduct({ trackId: 529443604, trackName: "SnoreLab" }, PRODUCT), false);
});

test("a slug survives punctuation and spaces", () => {
  assert.equal(slugify("SnoreLab : Record Your Snoring"), "snorelab-record-your-snoring");
  assert.equal(slugify("Xi'an Monster Software"), "xi-an-monster-software");
});

test("a product file missing its search terms is refused, not run empty", () => {
  assert.throws(() => validateProduct({ ...PRODUCT, searchTerms: [] }), /search term/);
  assert.throws(() => validateProduct({ ...PRODUCT, name: "" }), /missing/);
  assert.throws(
    () => validateProduct({ ...PRODUCT, brandTerms: undefined as unknown as string[] }),
    /brandTerms/,
  );
  assert.equal(validateProduct(PRODUCT).productId, "hush-log");
});

test("finds advertising platforms in markup and in a tag container", () => {
  const markup = `<script src="https://www.googletagmanager.com/gtm.js?id=GTM-MBBM2578"></script>`;
  assert.deepEqual(findContainerIds(markup), ["GTM-MBBM2578"]);

  const found = scan(`connect.facebook.net/en_US/fbevents.js gtag/js?id=AW-123 app.adjust.com`);
  const names = found.map((hit) => hit.platform);
  assert.ok(names.includes("Meta"));
  assert.ok(names.includes("Google Ads"));
  assert.ok(names.includes("Adjust"));
  assert.equal(found.find((hit) => hit.platform === "Adjust")?.kind, "attribution");
});

test("a site with no advertising tags reports none rather than guessing", () => {
  assert.deepEqual(scan("<html><body>hello</body></html>"), []);
  assert.deepEqual(findContainerIds("<html></html>"), []);
});

test("a billing complaint is recognised in the words customers actually use", () => {
  assert.ok(themesFor("Ended up paying £59.99 for a free trial").includes("money and subscription"));
  assert.ok(themesFor("I cannot cancel the subscription").includes("money and subscription"));
  assert.ok(themesFor("The app crashed every night").includes("crashes and bugs"));
  assert.deepEqual(themesFor("Lovely app, works well"), []);
});

const REVIEWS: Review[] = [
  { appId: "1", rating: 1, title: "Want refund", body: "Ended up paying £59.99. Not happy.", version: "1", updated: "" },
  { appId: "1", rating: 2, title: "Paywall", body: "Could not listen back without paying.", version: "1", updated: "" },
  { appId: "1", rating: 5, title: "Great", body: "Works perfectly.", version: "1", updated: "" },
];

test("only low star reviews are counted, and the share is of those", () => {
  const voice = summariseVoice("snorelab", REVIEWS);
  assert.equal(voice.reviewsRead, 3);
  assert.equal(voice.lowReviews, 2);
  const money = voice.themes.find((theme) => theme.name === "money and subscription");
  assert.equal(money?.count, 2);
  assert.equal(money?.share, 100);
});

test("an app with no low star reviews reports zero rather than dividing by it", () => {
  const voice = summariseVoice("x", [REVIEWS[2] as Review]);
  assert.equal(voice.lowReviews, 0);
  assert.deepEqual(voice.themes, []);
});

const PICTURE: DistributionPicture = {
  product: PRODUCT,
  readAt: "2026-08-14T00:00:00.000Z",
  rivals: [
    {
      rivalId: "snorelab",
      name: "SnoreLab",
      appleAppId: "529443604",
      seller: "Reviva Softworks Ltd",
      domain: "https://www.snorelab.com",
      formattedPrice: "Free",
      isFree: true,
      ratingCount: 14065,
      averageRating: 4.7,
      releaseDate: "2012-10-26",
      lastUpdated: "2026-08-06",
      foundVia: [{ term: "snoring", position: 1 }],
    },
  ],
  advertisers: [
    {
      platform: "meta",
      advertiserId: "149967288461419",
      rivalId: "snorelab",
      name: "SnoreLab",
      matchConfidence: "confirmed",
      activeAdCountAtLeast: 10,
    },
  ],
  ads: [],
  hooks: [
    {
      platform: "meta",
      advertiser: "SnoreLab",
      copy: "Have you been told you snore?",
      creatives: 82,
      runs: 16,
      longestRunDays: 15,
      firstSeen: "2025-12-17",
      lastSeen: "2026-02-03",
      stillRunning: false,
    },
  ],
  presence: [
    {
      rivalId: "snorelab",
      url: "https://www.snorelab.com",
      httpStatus: 200,
      advertisingPlatforms: ["Google Ads", "Microsoft Ads"],
      attributionProviders: [],
      analytics: ["Google Analytics"],
      tagContainers: ["GTM-MBBM2578"],
    },
  ],
  voice: [summariseVoice("snorelab", REVIEWS)],
  categoryAdvertisers: [
    { platform: "meta", term: "snoring", name: "SnoreLab", advertiserId: "149967288461419", count: 10 },
  ],
  gaps: ["Apple Search Ads publishes no library."],
};

test("the report leads with how the category sells and names the price model", () => {
  const report = buildReport(PICTURE);
  assert.match(report, /## How the category sells/);
  assert.match(report, /Every rival found is free to install/);
  assert.ok(report.indexOf("How the category sells") < report.indexOf("Where they buy"));
});

test("the report states the hook by what was put behind it, not by length of run", () => {
  const report = buildReport(PICTURE);
  assert.match(report, /\*\*82 creatives\*\*, 16 runs/);
  assert.match(report, /not by how long an advertisement ran/);
});

test("the report never hides what could not be read", () => {
  const report = buildReport(PICTURE);
  assert.match(report, /## What could not be read/);
  assert.match(report, /Apple Search Ads publishes no library/);
});

test("the report says a pixel is not proof of spend", () => {
  const report = buildReport(PICTURE);
  assert.match(report, /not\s+proof of spend/);
  assert.match(report, /match confirmed/);
});

test("a picture with nothing in it still renders every heading", () => {
  const empty: DistributionPicture = {
    ...PICTURE,
    rivals: [],
    advertisers: [],
    hooks: [],
    presence: [],
    voice: [],
    categoryAdvertisers: [],
    gaps: [],
  };
  const report = buildReport(empty);
  for (const heading of [
    "How the category sells",
    "Where they buy",
    "What they say",
    "Who else bids on these words",
    "What their customers are angry about",
    "What could not be read",
  ]) {
    assert.match(report, new RegExp(heading));
  }
  assert.match(report, /Nothing was skipped/);
});

test("a result that only mentions a term once, far down, is not a rival", () => {
  // WhatsApp Messenger appeared at position 10 of one term in the first MacGleam run.
  assert.equal(isRelevant([{ term: "clean my mac", position: 10 }]), false);
  // Device Monitor at position 1 of one term is a real adjacent product.
  assert.equal(isRelevant([{ term: "system monitor mac", position: 1 }]), true);
  // Two terms is enough on its own, wherever it placed.
  assert.equal(
    isRelevant([
      { term: "mac cleaner", position: 12 },
      { term: "disk space", position: 9 },
    ]),
    true,
  );
  assert.equal(isRelevant([]), false);
});

test("a withheld rating count is never printed as zero, even beside a published one", () => {
  const first = PICTURE.rivals[0] as (typeof PICTURE.rivals)[number];
  const mixed: DistributionPicture = {
    ...PICTURE,
    rivals: [
      { ...first, rivalId: "cleanmymac", name: "CleanMyMac", ratingCount: 0 },
      { ...first, rivalId: "status-monitor", name: "Status Monitor", ratingCount: 16 },
    ],
  };
  const report = buildReport(mixed);
  assert.match(report, /CleanMyMac: Free, ratings not published/);
  assert.match(report, /Status Monitor: Free, 16 ratings/);
  assert.doesNotMatch(report, /0 ratings/);
  assert.match(report, /no rating count for 1 of these 2 rivals/);
});

test("a set where every count is published carries no withheld note", () => {
  const report = buildReport(PICTURE);
  assert.match(report, /14065 ratings/);
  assert.doesNotMatch(report, /ratings not published/);
  assert.doesNotMatch(report, /publishes no rating count for/);
});
