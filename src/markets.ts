/**
 * Reads one rival across every market instead of one.
 *
 * Everything else in the pipeline takes a single market from the product file
 * and threads it through, so the whole system could only answer "what does this
 * rival do in our country". It could not ask where their market is. Reading
 * ShutEye in Great Britain alone gave 12 live advertisements and the conclusion
 * that the category's paid layer is thin. The same rival runs 70 in the United
 * States and something in 30 of 40 markets, and Great Britain is their smallest
 * campaign of the lot.
 *
 * Two counts per market, because either one alone lies:
 *
 *   Advertisements say where the rival is buying today. They are a count of
 *   objects, never a budget, and a buyer can spend more on twelve than on
 *   seventy.
 *
 *   Ratings say where their customers already are. They are a lifetime total
 *   that only ever rises, so they describe the installed base and not demand
 *   this month.
 *
 * Great Britain reads as starved on the first and third largest on the second.
 * A report holding only one of them draws the wrong conclusion either way.
 */

import { activeAdvertiserPageUrl, parseResultCount } from "./meta.ts";
import type { MarketReading } from "./types.ts";

/**
 * The default sweep. Wide enough that an absent campaign is informative, and
 * every entry is a market Apple and the library both serve.
 */
export const WORLD_MARKETS: readonly string[] = [
  "US", "GB", "CA", "AU", "IE", "NZ",
  "DE", "FR", "ES", "IT", "NL", "BE", "SE", "NO", "DK", "FI", "PL", "PT", "CH", "AT",
  "BR", "MX", "AR", "CO",
  "JP", "KR", "TW", "HK", "SG", "MY", "PH", "ID", "TH", "VN", "IN",
  "TR", "AE", "SA", "ZA", "EG",
];

/**
 * Advertisements for every ten thousand lifetime ratings.
 *
 * The raw counts favour big countries, so a market with nine times the customers
 * looks nine times as busy whatever the rival is actually doing there. Dividing
 * one by the other reorders the whole list and is the honest counter reading.
 *
 * It has its own distortion and the report says so: a market with a tiny base
 * scores high on a handful of advertisements. Null where either number is
 * missing, and null where the base is zero, because dividing by it invents a
 * number nobody measured.
 */
export function pressurePer10k(reading: MarketReading): number | null {
  if (reading.liveAds === null || reading.ratings === null) return null;
  if (reading.ratings <= 0) return null;
  return reading.liveAds / (reading.ratings / 10_000);
}

export interface SweepSummary {
  readonly marketsRead: number;
  readonly marketsWithAds: number;
  readonly marketsUnread: number;
  readonly totalRatings: number;
  readonly busiest: MarketReading | null;
  readonly largestBase: MarketReading | null;
  /** Markets holding customers and running nothing. The finding worth reading. */
  readonly quietWithCustomers: readonly MarketReading[];
}

/** How many ratings a market needs before an absent campaign is worth naming. */
const NOTABLE_BASE = 1000;

export function summariseSweep(sweep: readonly MarketReading[]): SweepSummary {
  const read = sweep.filter((entry) => entry.liveAds !== null);
  const withAds = read.filter((entry) => (entry.liveAds ?? 0) > 0);
  const rated = sweep.filter((entry) => entry.ratings !== null);

  const busiest = [...withAds].sort((left, right) => (right.liveAds ?? 0) - (left.liveAds ?? 0))[0] ?? null;
  const largestBase = [...rated].sort((left, right) => (right.ratings ?? 0) - (left.ratings ?? 0))[0] ?? null;

  return {
    marketsRead: read.length,
    marketsWithAds: withAds.length,
    marketsUnread: sweep.length - read.length,
    totalRatings: rated.reduce((sum, entry) => sum + (entry.ratings ?? 0), 0),
    busiest,
    largestBase,
    quietWithCustomers: read
      .filter((entry) => entry.liveAds === 0 && (entry.ratings ?? 0) >= NOTABLE_BASE)
      .sort((left, right) => (right.ratings ?? 0) - (left.ratings ?? 0)),
  };
}

/** Sorted for the report: most customers first, unrated markets last. */
export function byCustomerBase(sweep: readonly MarketReading[]): MarketReading[] {
  return [...sweep].sort((left, right) => (right.ratings ?? -1) - (left.ratings ?? -1));
}

/** Sorted by the counter reading, and markets with no advertisements are left out. */
export function byPressure(sweep: readonly MarketReading[]): MarketReading[] {
  return sweep
    .filter((entry) => (entry.liveAds ?? 0) > 0 && pressurePer10k(entry) !== null)
    .sort((left, right) => (pressurePer10k(right) ?? 0) - (pressurePer10k(left) ?? 0));
}

/**
 * The two things the sweep reads, passed in rather than imported.
 *
 * Keeping them out of this module keeps the driven browser out of it, so the
 * ranking and the null handling can be tested without launching Chrome, and the
 * sweep itself can be tested against a reader that returns an empty page and a
 * reader that fails.
 */
export interface SweepReaders {
  readonly readTexts: (urls: readonly string[]) => Promise<(string | null)[]>;
  readonly lookupApp: (
    appId: string,
    market: string,
  ) => Promise<{ userRatingCount?: number; formattedPrice?: string } | null>;
}

export interface SweepRequest {
  readonly advertiserId: string;
  readonly appleAppId: string | null;
  readonly markets?: readonly string[];
  readonly onMarket?: (reading: MarketReading) => void;
}

/**
 * Counts one advertiser in every market, and looks up the matching store entry
 * in each one.
 *
 * The advertisement count is read from the active filter on purpose. An all
 * statuses count would be larger and would also be a lie, because the library
 * rate limits the call that pages through it and stops without saying so.
 */
export async function readMarketSweep(
  readers: SweepReaders,
  request: SweepRequest,
): Promise<MarketReading[]> {
  const markets = request.markets ?? WORLD_MARKETS;
  const texts = await readers.readTexts(
    markets.map((market) => activeAdvertiserPageUrl(request.advertiserId, market)),
  );

  const sweep: MarketReading[] = [];
  for (let index = 0; index < markets.length; index += 1) {
    const market = (markets[index] as string).toUpperCase();
    const text = texts[index];
    const app = request.appleAppId
      ? await readers.lookupApp(request.appleAppId, market.toLowerCase())
      : null;
    const reading: MarketReading = {
      market,
      advertiserId: request.advertiserId,
      // A page that never arrived is unread. It is not a market with nothing in
      // it, and the two must not collapse into one number.
      liveAds: text === null || text === undefined ? null : parseResultCount(text),
      ratings: app?.userRatingCount ?? null,
      formattedPrice: app?.formattedPrice ?? null,
    };
    sweep.push(reading);
    request.onMarket?.(reading);
  }

  return sweep;
}
