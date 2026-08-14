/**
 * Reads the Meta Ad Library.
 *
 * Two things come out of it, and the second is the one nobody expects.
 *
 * 1. The advertisements themselves, with how long each ran and how many
 *    creatives share its copy.
 * 2. An advertiser census. The library's own filter response lists every page
 *    matching a search with a count beside it, so one search returns the whole
 *    set of advertisers in a category, including ones we had never heard of.
 *    The count saturates at the page size, so 10 means "10 or more".
 *
 * The library shows a run in two shapes. A keyword search says "Started running
 * on 29 Jul 2026". An advertiser page says "30 Dec 2025 - 8 Jan 2026". Only the
 * second gives an end, so only the second gives a finished length of run.
 */

import type { Ad, Platform, ProvenHook } from "./types.ts";

export const META: Platform = "meta";

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export interface AdvertiserCount {
  readonly advertiserId: string;
  readonly name: string;
  readonly count: number;
}

/**
 * A store title is not a brand. "SnoreLab : Record Your Snoring" is how Apple
 * lists it; "SnoreLab" is what the advertiser account is called and what appears
 * in the copy. Searching the full title finds nothing at all.
 *
 * So the brand is the part before the first separator, and a trailing word that
 * only names the kind of thing is dropped. The two escapes in the class are the
 * long dashes some publishers put in a title.
 */
const TITLE_SEPARATORS = /\s*[:|\u2013\u2014-]\s*|\s+\(/;

const DESCRIPTIVE_TAIL = /\s+(app|free|pro|lite|hd|mobile|for\s+\w+)$/i;

export function brandOf(storeTitle: string): string {
  const head = storeTitle.split(TITLE_SEPARATORS)[0] ?? storeTitle;
  return head.replace(DESCRIPTIVE_TAIL, "").trim();
}

export function keywordSearchUrl(
  term: string,
  market: string,
  options: { readonly activeOnly?: boolean } = {},
): string {
  // A rival whose campaign has ended is invisible to an active only search, so
  // "no advertiser found" would be a false reading of "they are not running
  // anything this week". SnoreLab's last United Kingdom run ended on 3 February.
  const status = options.activeOnly === false ? "all" : "active";
  // The search is case sensitive, and it fails quietly rather than loudly.
  // "snorelab" returns SnoreLab with ten advertisements. "SnoreLab" returns a
  // different set of twenty six advertisers that does not contain them at all,
  // so the capitalised form reads as "this company does not advertise".
  return (
    `https://www.facebook.com/ads/library/?active_status=${status}&ad_type=all` +
    `&country=${market.toUpperCase()}&q=${encodeURIComponent(term.toLowerCase())}` +
    "&search_type=keyword_unordered&media_type=all"
  );
}

export function advertiserPageUrl(advertiserId: string, market: string): string {
  return (
    "https://www.facebook.com/ads/library/?active_status=all&ad_type=all" +
    `&country=${market.toUpperCase()}&view_all_page_id=${advertiserId}`
  );
}

export function parseLibraryDate(value: string): Date | null {
  const match = value.match(/(\d{1,2}) (\w{3})\w* (\d{4})/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const month = MONTHS[match[2]];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
}

/** Inclusive, so a run that starts and ends on one day counts as one day. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/**
 * A video advertisement often carries no words, so the first line under
 * "Sponsored" is the player readout rather than the copy. Listing "0:00 / 0:37"
 * as a rival's proven hook makes the whole report look broken.
 */
const PLAYER_READOUT = /^\d{1,2}:\d{2}(\s*\/\s*\d{1,2}:\d{2})?$/;

export function firstRealLine(bodyLines: readonly string[]): string {
  const line = bodyLines
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0 && !PLAYER_READOUT.test(candidate));
  return (line ?? "").slice(0, 200);
}

export function parseAds(pageText: string, readAt: Date = new Date()): Ad[] {
  const marker = "Library ID: ";
  const positions: number[] = [];
  let cursor = pageText.indexOf(marker);
  while (cursor !== -1) {
    positions.push(cursor);
    cursor = pageText.indexOf(marker, cursor + marker.length);
  }

  const ads: Ad[] = [];
  for (let index = 0; index < positions.length; index += 1) {
    const start = positions[index] as number;
    const end = index + 1 < positions.length ? (positions[index + 1] as number) : pageText.length;
    const chunk = pageText.slice(start + marker.length, end);
    const preceding = pageText.slice(Math.max(0, start - 80), start);

    const lines = chunk.split("\n");
    const libraryId = (lines[0] ?? "").trim();
    if (!/^\d+$/.test(libraryId)) continue;

    const rangeMatch = chunk.match(/(\d{1,2} \w{3,9} \d{4})\s*-\s*(\d{1,2} \w{3,9} \d{4})/);
    const startedMatch = chunk.match(/Started running on ([^\n·]+)/);
    const shareMatch = chunk.match(/(\d+) ads use this creative and text/);

    const startedRunning = rangeMatch?.[1]?.trim() ?? startedMatch?.[1]?.trim() ?? null;
    const ended = rangeMatch?.[2]?.trim() ?? null;
    const startDate = startedRunning ? parseLibraryDate(startedRunning) : null;
    const endDate = ended ? parseLibraryDate(ended) : null;

    const sponsoredIndex = lines.findIndex((line) => line.trim() === "Sponsored");
    const advertiser = sponsoredIndex > 0 ? (lines[sponsoredIndex - 1] ?? "").trim() || null : null;
    const bodyLines = sponsoredIndex >= 0 ? lines.slice(sponsoredIndex + 1) : [];
    const body = bodyLines.join("\n").replace(/​/g, "").trim();

    ads.push({
      platform: META,
      libraryId,
      advertiserId: null,
      advertiser,
      startedRunning,
      ended,
      daysLive: startDate ? daysBetween(startDate, endDate ?? readAt) : null,
      active: /\bInactive\b/.test(preceding) ? false : /\bActive\b/.test(preceding),
      creativeShareCount: shareMatch ? Number(shareMatch[1]) : 1,
      bodyFirstLine: firstRealLine(bodyLines),
      bodyChars: body.length,
      body,
    });
  }

  return ads;
}

export function parseAdvertiserCensus(
  captures: readonly { body: string }[],
): AdvertiserCount[] {
  const found = new Map<string, AdvertiserCount>();

  for (const capture of captures) {
    if (!capture.body.includes("dynamic_filter_options")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(capture.body);
    } catch {
      continue;
    }
    const pages = (
      parsed as {
        data?: { ad_library_main?: { dynamic_filter_options?: { pages?: unknown[] } } };
      }
    )?.data?.ad_library_main?.dynamic_filter_options?.pages;
    if (!Array.isArray(pages)) continue;

    for (const entry of pages) {
      const page = entry as { key?: string; display_name?: string; count?: number };
      if (!page.key) continue;
      found.set(page.key, {
        advertiserId: page.key,
        name: (page.display_name ?? "").trim(),
        count: page.count ?? 0,
      });
    }
  }

  return [...found.values()].sort((left, right) => right.count - left.count);
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Decides which advertiser in a census is the rival.
 *
 * This is the hard join in the whole system, and a wrong match poisons every
 * finding below it, so a name that merely contains the rival's name is marked
 * probable rather than confirmed and the report says which is which.
 */
export function matchAdvertiser(
  rivalName: string,
  census: readonly AdvertiserCount[],
): { advertiserId: string; name: string; confidence: "confirmed" | "probable"; count: number } | null {
  // Try the full store title and the brand inside it. Apple lists
  // "SnoreLab : Record Your Snoring"; the advertiser account is "SnoreLab".
  const candidates = [...new Set([normalise(rivalName), normalise(brandOf(rivalName))])].filter(
    (candidate) => candidate.length >= 3,
  );
  if (candidates.length === 0) return null;
  const target = candidates[candidates.length - 1] as string;

  for (const candidate of candidates) {
    const exact = census.find((entry) => normalise(entry.name) === candidate);
    if (exact) {
      return { advertiserId: exact.advertiserId, name: exact.name, confidence: "confirmed", count: exact.count };
    }
  }

  const contained = census
    .filter((entry) => {
      const candidate = normalise(entry.name);
      return candidate.length >= 3 && (candidate.startsWith(target) || target.startsWith(candidate));
    })
    .sort((left, right) => right.count - left.count)[0];

  if (contained) {
    return {
      advertiserId: contained.advertiserId,
      name: contained.name,
      confidence: "probable",
      count: contained.count,
    };
  }

  return null;
}

/**
 * Groups advertisements by their copy and ranks the groups by how many
 * creatives sit behind each one.
 *
 * Length of run is reported but does not rank, because a seasonal application
 * category has no long runs to rank by. What a company repeats is the sentence,
 * not the advertisement.
 */
export function rankHooks(ads: readonly Ad[]): ProvenHook[] {
  const groups = new Map<string, Ad[]>();
  for (const ad of ads) {
    const key = `${ad.advertiser ?? "unknown"}::${ad.bodyFirstLine}`;
    const list = groups.get(key) ?? [];
    list.push(ad);
    groups.set(key, list);
  }

  const hooks: ProvenHook[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;

    const dates = group
      .map((ad) => (ad.startedRunning ? parseLibraryDate(ad.startedRunning) : null))
      .filter((date): date is Date => date !== null)
      .sort((left, right) => left.getTime() - right.getTime());
    const ends = group
      .map((ad) => (ad.ended ? parseLibraryDate(ad.ended) : null))
      .filter((date): date is Date => date !== null)
      .sort((left, right) => left.getTime() - right.getTime());

    const runLengths = group
      .map((ad) => ad.daysLive)
      .filter((days): days is number => days !== null);

    hooks.push({
      platform: META,
      advertiser: first.advertiser ?? "unknown",
      copy: first.bodyFirstLine,
      creatives: group.reduce((total, ad) => total + ad.creativeShareCount, 0),
      runs: group.length,
      longestRunDays: runLengths.length > 0 ? Math.max(...runLengths) : null,
      firstSeen: dates[0]?.toISOString().slice(0, 10) ?? null,
      lastSeen: ends[ends.length - 1]?.toISOString().slice(0, 10) ?? null,
      stillRunning: group.some((ad) => ad.active),
    });
  }

  return hooks.sort((left, right) => {
    if (right.creatives !== left.creatives) return right.creatives - left.creatives;
    return right.runs - left.runs;
  });
}
