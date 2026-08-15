import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import {
  byAdvertiser,
  byCustomerBase,
  byPressure,
  marketMatrix,
  pressurePer10k,
  readMarketSweep,
  summariseSweep,
  WORLD_MARKETS,
  type SweepReaders,
} from "./markets.ts";
import { activeAdvertiserPageUrl, parseResultCount } from "./meta.ts";
import type { MarketReading } from "./types.ts";

function reading(overrides: Partial<MarketReading> & { market: string }): MarketReading {
  return {
    advertiserId: "105561090976700",
    liveAds: 0,
    ratings: 0,
    formattedPrice: "Free",
    ...overrides,
  };
}

test("the active advertiser address filters to what is running now", () => {
  const url = activeAdvertiserPageUrl("105561090976700", "us");
  ok(url.includes("active_status=active"), url);
  ok(url.includes("country=US"), url);
  ok(url.includes("view_all_page_id=105561090976700"), url);
});

test("a result count is read in every shape the library writes it", () => {
  strictEqual(parseResultCount("~3,500 results"), 3500);
  strictEqual(parseResultCount("~12 results"), 12);
  strictEqual(parseResultCount("1 result"), 1);
});

test("the empty state is zero, and an unreadable page is not", () => {
  strictEqual(parseResultCount("No ads match your search criteria"), 0);
  // The single most important distinction in the sweep. A page that never
  // loaded and an advertiser running nothing look identical, and only one of
  // them licenses the sentence "they run nothing here".
  strictEqual(parseResultCount("Meta Ad Library\nFilters\nSort"), null);
  strictEqual(parseResultCount(""), null);
});

test("advertising pressure divides advertisements by the customer base", () => {
  strictEqual(pressurePer10k(reading({ market: "GB", liveAds: 12, ratings: 33470 }))?.toFixed(1), "3.6");
  strictEqual(pressurePer10k(reading({ market: "US", liveAds: 70, ratings: 349104 }))?.toFixed(1), "2.0");
});

test("pressure is null rather than infinite when the base is zero or missing", () => {
  strictEqual(pressurePer10k(reading({ market: "XX", liveAds: 9, ratings: 0 })), null);
  strictEqual(pressurePer10k(reading({ market: "XX", liveAds: 9, ratings: null })), null);
  strictEqual(pressurePer10k(reading({ market: "XX", liveAds: null, ratings: 500 })), null);
});

test("the summary counts markets read, not markets asked for", () => {
  const summary = summariseSweep([
    reading({ market: "US", liveAds: 70, ratings: 349104 }),
    reading({ market: "GB", liveAds: 12, ratings: 33470 }),
    reading({ market: "IE", liveAds: 0, ratings: 2085 }),
    reading({ market: "ZZ", liveAds: null, ratings: null }),
  ]);
  strictEqual(summary.marketsRead, 3);
  strictEqual(summary.marketsWithAds, 2);
  strictEqual(summary.marketsUnread, 1);
  strictEqual(summary.busiest?.market, "US");
  strictEqual(summary.largestBase?.market, "US");
  strictEqual(summary.totalRatings, 349104 + 33470 + 2085);
});

test("an unread market is never reported as a market running nothing", () => {
  const summary = summariseSweep([reading({ market: "ZZ", liveAds: null, ratings: 90000 })]);
  strictEqual(summary.marketsWithAds, 0);
  strictEqual(summary.marketsRead, 0);
  deepStrictEqual(summary.quietWithCustomers, []);
});

test("markets with customers and no campaign are surfaced, largest base first", () => {
  const summary = summariseSweep([
    reading({ market: "TW", liveAds: 0, ratings: 12175 }),
    reading({ market: "MX", liveAds: 0, ratings: 11907 }),
    reading({ market: "FI", liveAds: 0, ratings: 12 }),
    reading({ market: "US", liveAds: 70, ratings: 349104 }),
  ]);
  deepStrictEqual(
    summary.quietWithCustomers.map((entry) => entry.market),
    ["TW", "MX"],
  );
});

test("the two orderings disagree, which is why the report carries both", () => {
  const sweep = [
    reading({ market: "US", liveAds: 70, ratings: 349104 }),
    reading({ market: "GB", liveAds: 12, ratings: 33470 }),
    reading({ market: "FI", liveAds: 18, ratings: 473 }),
  ];
  deepStrictEqual(byCustomerBase(sweep).map((entry) => entry.market), ["US", "GB", "FI"]);
  deepStrictEqual(byPressure(sweep).map((entry) => entry.market), ["FI", "GB", "US"]);
});

test("a market running nothing is left out of the pressure ordering", () => {
  const ordered = byPressure([
    reading({ market: "IE", liveAds: 0, ratings: 2085 }),
    reading({ market: "GB", liveAds: 12, ratings: 33470 }),
  ]);
  deepStrictEqual(ordered.map((entry) => entry.market), ["GB"]);
});

function readersFor(pages: readonly (string | null)[], ratings: Record<string, number> = {}): SweepReaders {
  return {
    readTexts: async () => [...pages],
    lookupApp: async (_appId, market) => {
      const count = ratings[market];
      return count === undefined ? null : { userRatingCount: count, formattedPrice: "Free" };
    },
  };
}

test("the sweep reads one advertiser across the markets it is given", async () => {
  const sweep = await readMarketSweep(
    readersFor(["~70 results", "~12 results", "No ads match your search criteria"], {
      us: 349104,
      gb: 33470,
      ie: 2085,
    }),
    { advertiserId: "105561090976700", appleAppId: "1490078804", markets: ["us", "gb", "ie"] },
  );

  deepStrictEqual(
    sweep.map((entry) => [entry.market, entry.liveAds, entry.ratings]),
    [
      ["US", 70, 349104],
      ["GB", 12, 33470],
      ["IE", 0, 2085],
    ],
  );
});

test("a page the browser could not read comes back unread, not empty", async () => {
  const sweep = await readMarketSweep(readersFor([null], { us: 349104 }), {
    advertiserId: "1",
    appleAppId: "1490078804",
    markets: ["us"],
  });
  strictEqual(sweep[0]?.liveAds, null);
  strictEqual(sweep[0]?.ratings, 349104);
});

test("a storefront that does not carry the app leaves ratings unpublished", async () => {
  const sweep = await readMarketSweep(readersFor(["~5 results"]), {
    advertiserId: "1",
    appleAppId: "1490078804",
    markets: ["cn"],
  });
  strictEqual(sweep[0]?.ratings, null);
  strictEqual(sweep[0]?.liveAds, 5);
});

test("no app identifier means no store lookup at all", async () => {
  let called = false;
  const sweep = await readMarketSweep(
    {
      readTexts: async () => ["~3 results"],
      lookupApp: async () => {
        called = true;
        return null;
      },
    },
    { advertiserId: "1", appleAppId: null, markets: ["us"] },
  );
  strictEqual(called, false);
  strictEqual(sweep[0]?.liveAds, 3);
});

test("the default sweep is wide and holds no duplicates", () => {
  ok(WORLD_MARKETS.length >= 30, `only ${WORLD_MARKETS.length} markets`);
  strictEqual(new Set(WORLD_MARKETS).size, WORLD_MARKETS.length);
  ok(WORLD_MARKETS.every((market) => /^[A-Z]{2}$/.test(market)));
});

test("a flat sweep splits back into one list per advertiser, in sweep order", () => {
  const grouped = byAdvertiser([
    reading({ market: "US", advertiserId: "a", liveAds: 0 }),
    reading({ market: "US", advertiserId: "b", liveAds: 70 }),
    reading({ market: "GB", advertiserId: "a", liveAds: 0 }),
  ]);
  deepStrictEqual([...grouped.keys()], ["a", "b"]);
  strictEqual(grouped.get("a")?.length, 2);
  strictEqual(grouped.get("b")?.length, 1);
});

test("the matrix puts two rivals on one row per market", () => {
  const rows = marketMatrix(
    [
      reading({ market: "US", advertiserId: "a", liveAds: 0, ratings: 57114 }),
      reading({ market: "US", advertiserId: "b", liveAds: 70, ratings: 349104 }),
      reading({ market: "GB", advertiserId: "a", liveAds: 0, ratings: 14064 }),
      reading({ market: "GB", advertiserId: "b", liveAds: 12, ratings: 33470 }),
    ],
    ["a", "b"],
  );
  deepStrictEqual(rows.map((row) => row.market), ["US", "GB"]);
  strictEqual(rows[0]?.cells[0]?.liveAds, 0);
  strictEqual(rows[0]?.cells[1]?.liveAds, 70);
});

test("a market only one rival sells in still gets a row, with a hole for the other", () => {
  const rows = marketMatrix(
    [
      reading({ market: "US", advertiserId: "a", ratings: 10 }),
      reading({ market: "JP", advertiserId: "b", ratings: 65902 }),
    ],
    ["a", "b"],
  );
  // Ordered by the largest base any rival has there, so a market that matters to
  // one rival is never buried because the other rival ignores it.
  deepStrictEqual(rows.map((row) => row.market), ["JP", "US"]);
  strictEqual(rows[0]?.cells[0], null);
  strictEqual(rows[0]?.cells[1]?.ratings, 65902);
});

test("an advertiser column with no readings at all is all holes, never an error", () => {
  const rows = marketMatrix([reading({ market: "US", advertiserId: "a", ratings: 5 })], ["a", "missing"]);
  strictEqual(rows[0]?.cells[1], null);
  strictEqual(rows.length, 1);
});
