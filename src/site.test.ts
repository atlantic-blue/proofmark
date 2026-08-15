import { test } from "node:test";
import assert from "node:assert/strict";
import { axisOf, barGeometry, buildIndex, buildSite, escapeHtml, spanOf } from "./site.ts";
import type { Ad, DistributionPicture } from "./types.ts";

function ad(overrides: Partial<Ad>): Ad {
  return {
    platform: "meta",
    libraryId: "1",
    libraryUrl: "https://www.facebook.com/ads/library/?id=1",
    format: "video",
    mediaUrls: [],
    advertiserId: "a",
    advertiser: "SnoreLab",
    startedRunning: "1 Jan 2026",
    ended: "10 Jan 2026",
    daysLive: 10,
    active: false,
    creativeShareCount: 1,
    bodyFirstLine: "copy",
    bodyChars: 4,
    body: "copy",
    ...overrides,
  };
}

const READ_AT = "2026-08-14T00:00:00.000Z";

const PICTURE: DistributionPicture = {
  product: {
    productId: "hush-log",
    name: "Hush Log",
    job: "records snoring",
    market: "gb",
    storeEntity: "software",
    searchTerms: ["snoring"],
    brandTerms: ["hush log"],
  },
  readAt: READ_AT,
  rivals: [
    {
      rivalId: "snorelab",
      name: "SnoreLab",
      appleAppId: "529443604",
      seller: "Reviva",
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
  ads: [ad({}), ad({ libraryId: "2", startedRunning: "1 Jun 2026", ended: null, daysLive: 74, active: true })],
  hooks: [
    {
      platform: "meta",
      advertiser: "SnoreLab",
      copy: 'Have you been told you snore? <script>alert("x")</script>',
      formats: ["video"],
      exampleUrl: "https://www.facebook.com/ads/library/?id=1",
      exampleMedia: ["https://scontent.example/creative.jpg?a=1&b=2"],
      runLengths: [15, 9],
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
      advertisingPlatforms: ["Google Ads"],
      attributionProviders: [],
      analytics: [],
      tagContainers: [],
    },
  ],
  voice: [
    {
      rivalId: "snorelab",
      reviewsRead: 500,
      lowReviews: 96,
      themes: [{ name: "money and subscription", count: 29, share: 30, quotes: ["Definitely not free: £9.99 per month"] }],
    },
  ],
  categoryAdvertisers: [
    { platform: "meta", term: "snoring", name: "SnoreLab", advertiserId: "149967288461419", count: 10 },
  ],
  gaps: ["Apple Search Ads publishes no library."],
};

test("markup in the data is escaped, never rendered", () => {
  assert.equal(escapeHtml('<script>"x" & \'y\'</script>'), "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;");
  const page = buildSite(PICTURE);
  assert.ok(!page.includes("<script>alert"), "rival copy must never execute");
  assert.match(page, /&lt;script&gt;alert/);
});

test("an advertisement still running is measured to the day of reading", () => {
  const live = spanOf(ad({ startedRunning: "1 Jun 2026", ended: null }), new Date(READ_AT));
  assert.equal(live?.end.toISOString().slice(0, 10), "2026-08-14");
  const finished = spanOf(ad({}), new Date(READ_AT));
  assert.equal(finished?.end.toISOString().slice(0, 10), "2026-01-10");
  assert.equal(spanOf(ad({ startedRunning: null }), new Date(READ_AT)), null);
});

test("the axis spans the earliest start to the latest end", () => {
  const axis = axisOf(PICTURE.ads, new Date(READ_AT));
  assert.equal(axis?.start.toISOString().slice(0, 10), "2026-01-01");
  assert.equal(axis?.end.toISOString().slice(0, 10), "2026-08-14");
  assert.equal(axisOf([], new Date(READ_AT)), null);
});

test("a bar sits where its run sits, and a one day run stays visible", () => {
  const axis = { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-01-11T00:00:00Z") };
  const half = barGeometry({ start: new Date("2026-01-06T00:00:00Z"), end: new Date("2026-01-11T00:00:00Z") }, axis);
  assert.equal(Math.round(half.left), 50);
  assert.equal(Math.round(half.width), 50);

  const oneDay = barGeometry({ start: new Date("2026-01-02T00:00:00Z"), end: new Date("2026-01-02T00:00:00Z") }, axis);
  assert.ok(oneDay.width >= 0.5, "a single day run must not be invisible");

  // A bar may never run off the end of the chart.
  const overshoot = barGeometry({ start: new Date("2026-01-10T00:00:00Z"), end: new Date("2027-01-01T00:00:00Z") }, axis);
  assert.ok(overshoot.left + overshoot.width <= 100.01, `bar ran past the axis: ${overshoot.left + overshoot.width}`);
});

test("the page carries the counts, the copy and a link to every advertisement", () => {
  const page = buildSite(PICTURE);
  assert.match(page, /<title>Hush Log Rival Watch<\/title>/);
  assert.match(page, /2 advertisements read|>2<\/div><div class="stat-label">advertisements read/);
  assert.match(page, /82/);
  assert.match(page, /facebook\.com\/ads\/library\/\?id=1/);
  assert.match(page, /Open in the ad library/);
  assert.match(page, /View the creative/);
});

test("both themes are defined at token level, so neither renders on the other's ground", () => {
  const page = buildSite(PICTURE);
  assert.match(page, /:root \{[^}]*--ground:/, "the light palette must sit on bare :root");
  assert.match(page, /:root:not\(\[data-theme="light"\]\)/, "system dark must not beat an explicit light choice");
  assert.match(page, /:root\[data-theme="dark"\]/, "an explicit dark choice must win too");
  assert.match(page, /body \{[^}]*background: var\(--ground\)/, "a transparent body borrows the host ground");
});

test("a picture with nothing in it still renders rather than throwing", () => {
  const empty: DistributionPicture = {
    ...PICTURE,
    rivals: [],
    advertisers: [],
    ads: [],
    hooks: [],
    presence: [],
    voice: [],
    categoryAdvertisers: [],
    gaps: [],
  };
  const page = buildSite(empty);
  assert.match(page, /nothing to plot/);
  assert.match(page, /No advertisement copy was captured/);
  assert.match(page, /Nothing was skipped/);
});

test("the index lists every product report", () => {
  const index = buildIndex([
    { productId: "hush-log", name: "Hush Log", readAt: READ_AT, ads: 41 },
    { productId: "macgleam", name: "MacGleam", readAt: READ_AT, ads: 27 },
  ]);
  assert.match(index, /href="\.\/hush-log\/"/);
  assert.match(index, /href="\.\/macgleam\/"/);
  assert.match(index, /41 ads/);
  assert.match(buildIndex([]), /No report has been produced yet/);
});

const SWEEP = [
  { market: "US", advertiserId: "149967288461419", liveAds: 70, ratings: 349104, formattedPrice: "Free" },
  { market: "GB", advertiserId: "149967288461419", liveAds: 12, ratings: 33470, formattedPrice: "Free" },
  { market: "TW", advertiserId: "149967288461419", liveAds: 0, ratings: 12175, formattedPrice: "Free" },
  { market: "FI", advertiserId: "149967288461419", liveAds: 18, ratings: 473, formattedPrice: "Free" },
  { market: "ZZ", advertiserId: "149967288461419", liveAds: null, ratings: null, formattedPrice: null },
];

test("a picture written before the sweep existed still renders", () => {
  const page = buildSite(PICTURE);
  assert.ok(!page.includes("Where their market is"), "no sweep means no market section");
  assert.match(page, /GB in depth/);
  assert.ok(!page.includes("markets counted"), "an absent sweep must not claim a market count");
});

test("the market section carries both orderings, because they disagree", () => {
  const page = buildSite({ ...PICTURE, marketSweep: SWEEP });
  assert.match(page, /Where their market is/);
  assert.match(page, /GB in depth, 5 markets counted/);
  assert.match(page, /advertisements per 10,000 ratings/);

  // Raw counts put the United States first. Divided by the base, Finland leads
  // and the United States is last. A page showing only one of them is a way of
  // choosing the answer.
  const raw = page.indexOf('<ul class="markets">');
  const ranked = page.indexOf('markets markets-narrow');
  assert.ok(raw > -1 && ranked > raw, "the raw ordering comes first, the counter reading after it");
  assert.ok(page.indexOf(">US<", raw) < page.indexOf(">FI<", raw), "raw ordering leads with the largest base");
  assert.ok(page.indexOf(">FI<", ranked) < page.indexOf(">US<", ranked), "pressure ordering leads with the smallest base");
});

test("an unread market never renders as a market running nothing", () => {
  const page = buildSite({ ...PICTURE, marketSweep: SWEEP });
  assert.match(page, /unread/);
  assert.match(page, /none live/);
});

test("a market with customers and no campaign is named", () => {
  const page = buildSite({ ...PICTURE, marketSweep: SWEEP });
  assert.match(page, /Customers and no campaign: TW \(12,175\)/);
});

test("the page never claims the counts are money", () => {
  const page = buildSite({ ...PICTURE, marketSweep: SWEEP });
  assert.match(page, /Neither number is money/);
  assert.match(page, /publishes no spend/);
});
