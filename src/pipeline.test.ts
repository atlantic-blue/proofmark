import { test } from "node:test";
import assert from "node:assert/strict";
import { isOurOwnProduct, isRelevant, slugify } from "./apple.ts";
import { findContainerIds, scan } from "./platforms.ts";
import { summariseVoice, themesFor } from "./voice.ts";
import { buildReport, plural } from "./report.ts";
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
  ads: [
    {
      platform: "meta",
      libraryId: "1893577217926189",
      libraryUrl: "https://www.facebook.com/ads/library/?id=1893577217926189",
      format: "video",
      mediaUrls: ["https://video-lhr11-1.xx.fbcdn.net/o1/v/t2/f2/m412/example.mp4"],
      advertiserId: "149967288461419",
      advertiser: "SnoreLab",
      startedRunning: "30 Dec 2025",
      ended: "8 Jan 2026",
      daysLive: 10,
      active: false,
      creativeShareCount: 7,
      bodyFirstLine: "Have you been told you snore?",
      bodyChars: 29,
      body: "Have you been told you snore?",
    },
    {
      platform: "meta",
      libraryId: "1573380140661000",
      libraryUrl: "https://www.facebook.com/ads/library/?id=1573380140661000",
      format: "image",
      mediaUrls: [],
      advertiserId: "149967288461419",
      advertiser: "SnoreLab",
      startedRunning: "1 Aug 2026",
      ended: null,
      daysLive: 14,
      active: true,
      creativeShareCount: 3,
      bodyFirstLine: "Discover your BreathFlow",
      bodyChars: 24,
      body: "Discover your BreathFlow",
    },
  ],
  hooks: [
    {
      platform: "meta",
      advertiser: "SnoreLab",
      copy: "Have you been told you snore?",
      formats: ["video"],
      exampleUrl: "https://www.facebook.com/ads/library/?id=1893577217926189",
      exampleMedia: ["https://video-lhr11-1.xx.fbcdn.net/o1/v/t2/f2/m412/example.mp4"],
      runLengths: [15, 12, 9],
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
      { ...first, rivalId: "snoregym", name: "SnoreGym", ratingCount: 0 },
      { ...first, rivalId: "sound-sleep", name: "SoundSleep", ratingCount: 16 },
    ],
  };
  const report = buildReport(mixed);
  assert.match(report, /SnoreGym: Free, ratings not published/);
  assert.match(report, /SoundSleep: Free, 16 ratings/);
  assert.doesNotMatch(report, /0 ratings/);
  assert.match(report, /no rating count for 1 of these rivals/);
  // The note must not name a product from another category. It once cited
  // CleanMyMac inside a report about snoring applications.
  assert.doesNotMatch(report, /CleanMyMac/);
});

test("a set where every count is published carries no withheld note", () => {
  const report = buildReport(PICTURE);
  assert.match(report, /14065 ratings/);
  assert.doesNotMatch(report, /ratings not published/);
  assert.doesNotMatch(report, /publishes no rating count for/);
});

test("a count of one never reads as a plural, because a broken sentence loses the reader", () => {
  assert.equal(plural(1, "advertisements", "advertisement"), "1 advertisement");
  assert.equal(plural(2, "advertisements", "advertisement"), "2 advertisements");
  assert.equal(plural(0, "advertisements", "advertisement"), "0 advertisements");

  const single: DistributionPicture = {
    ...PICTURE,
    advertisers: [{ ...(PICTURE.advertisers[0] as (typeof PICTURE.advertisers)[number]), activeAdCountAtLeast: 1 }],
    hooks: [{ ...(PICTURE.hooks[0] as (typeof PICTURE.hooks)[number]), creatives: 1, runs: 1 }],
  };
  const report = buildReport(single);
  assert.match(report, /at least 1 active advertisement,/);
  assert.match(report, /\*\*1 creative\*\*, 1 run,/);
  assert.doesNotMatch(report, /1 advertisements|1 creatives|1 runs/);
});

test("an advertiser seen under several terms leads, and a matched rival is marked", () => {
  const picture: DistributionPicture = {
    ...PICTURE,
    categoryAdvertisers: [
      { platform: "meta", term: "snoring", name: "SnoreLab", advertiserId: "149967288461419", count: 10 },
      { platform: "meta", term: "snore", name: "SnoreLab", advertiserId: "149967288461419", count: 8 },
      { platform: "meta", term: "snoring", name: "Story-Time", advertiserId: "555", count: 10 },
    ],
  };
  const report = buildReport(picture);
  // Story-Time shows the same ten advertisements, so raw count cannot separate them.
  assert.match(report, /SnoreLab \(a rival we track\): 2 terms, up to 10 advertisements/);
  assert.doesNotMatch(report, /Story-Time: /);
  assert.match(report, /remaining 1 advertiser appeared under one term/);
});

test("a category where nothing repeats across terms says so rather than showing nothing", () => {
  const picture: DistributionPicture = {
    ...PICTURE,
    categoryAdvertisers: [
      { platform: "meta", term: "snoring", name: "Story-Time", advertiserId: "555", count: 10 },
    ],
  };
  assert.match(buildReport(picture), /No advertiser appeared under more than one term/);
});

test("more terms outranks a bigger count, because breadth is the category signal", () => {
  const picture: DistributionPicture = {
    ...PICTURE,
    advertisers: [],
    categoryAdvertisers: [
      { platform: "meta", term: "snoring", name: "Broad", advertiserId: "1", count: 2 },
      { platform: "meta", term: "snore", name: "Broad", advertiserId: "1", count: 2 },
      { platform: "meta", term: "sleep recorder", name: "Broad", advertiserId: "1", count: 2 },
      { platform: "meta", term: "snoring", name: "Loud", advertiserId: "2", count: 10 },
      { platform: "meta", term: "snore", name: "Loud", advertiserId: "2", count: 10 },
    ],
  };
  const report = buildReport(picture);
  assert.ok(
    report.indexOf("Broad") < report.indexOf("Loud"),
    "three terms at two advertisements must beat two terms at ten",
  );
});

test("the report opens with the geography, so a one market finding is never read as the world", () => {
  const report = buildReport({
    ...PICTURE,
    marketSweep: [
      { market: "US", advertiserId: "1", liveAds: 70, ratings: 349104, formattedPrice: "Free" },
      { market: "GB", advertiserId: "1", liveAds: 12, ratings: 33470, formattedPrice: "Free" },
      { market: "IE", advertiserId: "1", liveAds: 0, ratings: 2085, formattedPrice: "Free" },
    ],
  });
  assert.ok(
    report.indexOf("## Where their market is") < report.indexOf("## How the category sells"),
    "geography has to come before anything read in one country",
  );
  assert.match(report, /US is where they buy hardest, at 70 live/);
  assert.match(report, /GB, the market read in depth below, carries 12 live advertisements/);
  assert.match(report, /Live advertising in 2 of 3 markets read/);
  assert.match(report, /IE: 2,085 ratings, nothing live/);
  assert.match(report, /Neither number is money/);
});

test("a report with no sweep says so rather than staying silent about it", () => {
  const report = buildReport(PICTURE);
  assert.match(report, /No market sweep was run, so every finding below describes one country only/);
});

test("one live advertisement is written as one, not as 1 advertisements", () => {
  const report = buildReport({
    ...PICTURE,
    marketSweep: [{ market: "GB", advertiserId: "1", liveAds: 1, ratings: 10, formattedPrice: "Free" }],
  });
  assert.match(report, /carries 1 live advertisement\./);
});
