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


const SNORELAB = "149967288461419";
const SHUTEYE = "105561090976700";

function sweepFor(advertiserId: string, rows: readonly [string, number | null, number | null][]) {
  return rows.map(([market, liveAds, ratings]) => ({
    market,
    advertiserId,
    liveAds,
    ratings,
    formattedPrice: ratings === null ? null : "Free",
  }));
}

/** SnoreLab is dark everywhere. ShutEye is not. That contrast is the point. */
const TWO_RIVALS = {
  ...PICTURE,
  advertisers: [
    ...PICTURE.advertisers,
    {
      platform: "meta" as const,
      advertiserId: SHUTEYE,
      rivalId: "shuteye",
      name: "ShutEye - Sleep Tracker, Recorder",
      matchConfidence: "probable" as const,
      activeAdCountAtLeast: 10,
    },
  ],
  marketSweep: [
    ...sweepFor(SNORELAB, [
      ["US", 0, 57114],
      ["GB", 0, 14064],
      ["TW", 0, 12175],
      ["ZZ", null, null],
    ]),
    ...sweepFor(SHUTEYE, [
      ["US", 70, 349104],
      ["GB", 12, 33470],
      ["TW", 0, 12175],
      ["ZZ", null, null],
    ]),
  ],
};

const ONE_RIVAL = {
  ...PICTURE,
  marketSweep: sweepFor(SNORELAB, [
    ["US", 70, 349104],
    ["GB", 12, 33470],
    ["TW", 0, 12175],
    ["FI", 18, 473],
    ["ZZ", null, null],
  ]),
};

test("a picture written before the sweep existed still renders", () => {
  const page = buildSite(PICTURE);
  assert.ok(!page.includes("Where their market is"), "no sweep means no market section");
  assert.match(page, /GB in depth/);
  assert.ok(!page.includes("markets counted"), "an absent sweep must not claim a market count");
});

/** The row for one market out of one named matrix, so cells can be counted. */
function matrixRow(page: string, heading: string, market: string): string {
  const from = page.indexOf(heading);
  assert.ok(from > -1, `no matrix headed "${heading}"`);
  const list = page.slice(from, page.indexOf("</ul>", from));
  const rows = [...list.matchAll(/<li>[\s\S]*?<\/li>/g)].map((match) => match[0]);
  const row = rows.find((candidate) => candidate.includes(`>${market}<`));
  assert.ok(row, `no row for ${market} under "${heading}"`);
  return row;
}

test("every swept rival gets a column, not just the closest one", () => {
  const page = buildSite(TWO_RIVALS);
  assert.match(page, /2 rivals counted in 4 markets each/);

  // Counted in the row, not in the page. Counting how often a rival's name
  // appears passes while its column is missing, because the name is also in the
  // standings and the counter reading. This is the whole defect: SnoreLab was
  // the closest rival, SnoreLab is dark everywhere, and the published page said
  // nothing while ShutEye went unread.
  const live = matrixRow(page, "Who is buying where, today", "US");
  const cells = [...live.matchAll(/<span class="market-num">([\s\S]*?)<\/span>/g)].map((match) =>
    (match[1] ?? "").replace(/<[^>]*>/g, "").trim(),
  );
  assert.equal(cells.length, 2, `expected one cell per rival, got ${cells.length}: ${cells.join(" | ")}`);
  assert.deepEqual(cells, ["none", "70"], "SnoreLab runs none in the United States, ShutEye runs 70");

  const base = matrixRow(page, "Where the customers already are", "US");
  const baseCells = [...base.matchAll(/<span class="market-num">([\s\S]*?)<\/span>/g)].map((match) =>
    (match[1] ?? "").replace(/<[^>]*>/g, "").trim(),
  );
  assert.deepEqual(baseCells, ["57,114", "349,104"]);
});

test("a rival that runs nothing anywhere is stated, not left blank", () => {
  const page = buildSite(TWO_RIVALS);
  assert.match(page, /runs nothing anywhere today/);
  assert.match(page, /live in 2 of 3 markets, busiest US at 70/);
});

test("the counter reading names the rival it describes", () => {
  const page = buildSite(TWO_RIVALS);
  // Only ShutEye is buying, so the pressure reading is about ShutEye and says
  // so. Blending a dark rival into it would report a pressure nobody has.
  assert.match(page, /ShutEye - Sleep Tracker, Recorder advertisements per 10,000 ratings/);
});

test("the two orderings still disagree, which is why both are drawn", () => {
  const page = buildSite(ONE_RIVAL);
  const ranked = page.indexOf("argues with it");
  assert.ok(ranked > -1, "the counter reading must be drawn");
  assert.ok(page.indexOf(">FI<", ranked) < page.indexOf(">US<", ranked), "pressure leads with the smallest base");
  const raw = page.indexOf("Where the customers already are");
  assert.ok(page.indexOf(">US<", raw) < page.indexOf(">FI<", raw), "the customer base ordering leads with the largest");
});

test("an unread market never renders as a market running nothing", () => {
  const page = buildSite(TWO_RIVALS);
  assert.match(page, /unread/);
  assert.match(page, /none/);
});

test("a market with customers and no campaign is named against the rival it belongs to", () => {
  const page = buildSite(TWO_RIVALS);
  assert.match(page, /ShutEye - Sleep Tracker, Recorder has customers and no campaign in: TW \(12,175\)/);
});

test("the row template is declared on the list, so a narrow screen can still override it", () => {
  const page = buildSite(TWO_RIVALS);
  // An inline grid template on the row would outrank the media query and the
  // matrix would never respond. The custom property is what keeps it able to.
  assert.match(page, /<ul class="markets" style="--cols:34px 1fr 62px 1fr 62px;--cols-narrow:34px 62px 62px">/);
  assert.ok(!/<li style="grid-template-columns/.test(page), "no row may pin its own template");
});

test("the page never claims the counts are money", () => {
  const page = buildSite(TWO_RIVALS);
  assert.match(page, /Neither number is money/);
  assert.match(page, /publishes no spend/);
});

test("a rival matched to an advertiser is a link to its own page, and one that is not stays plain", () => {
  const page = buildSite({
    ...PICTURE,
    rivals: [
      ...PICTURE.rivals,
      { rivalId: "sleepwatch", name: "SleepWatch", appleAppId: "1", seller: "Bodymatter", domain: null, formattedPrice: "Free", isFree: true, ratingCount: 59064, averageRating: 4.6, releaseDate: "2016-01-01", lastUpdated: "2026-01-01", foundVia: [{ term: "sleep tracker", position: 2 }] },
    ],
  });
  assert.match(page, /<a href="\.\/snorelab\/">SnoreLab<\/a>/);
  // A link to a page that was never written is worse than no link, so a rival
  // with no advertiser account must not get one.
  assert.ok(!/<a href="\.\/sleepwatch\/">/.test(page), "an unmatched rival has no page to link to");
  assert.match(page, /SleepWatch/);
});
