/**
 * Everything the pipeline reads from Apple. No key, no account, no limit worth
 * worrying about.
 *
 * Three endpoints do the work: search finds rivals, lookup gives their price and
 * ratings, and the review feed gives what their unhappy customers say. The
 * review feed stops at ten pages of fifty, so 500 per app is the ceiling.
 */

import type { Product, Review, Rival } from "./types.ts";

const TIMEOUT_MS = 20_000;
const REVIEW_PAGES = 10;

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface AppleApp {
  trackId?: number;
  trackName?: string;
  sellerName?: string;
  sellerUrl?: string;
  formattedPrice?: string;
  price?: number;
  userRatingCount?: number;
  averageUserRating?: number;
  releaseDate?: string;
  currentVersionReleaseDate?: string;
  description?: string;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function isOurOwnProduct(app: AppleApp, product: Product): boolean {
  const name = (app.trackName ?? "").toLowerCase();
  if (product.appleAppId && String(app.trackId) === product.appleAppId) return true;
  return product.brandTerms.some((term) => name.includes(term.toLowerCase()));
}

function toRival(app: AppleApp, foundVia: { term: string; position: number }[]): Rival | null {
  if (!app.trackId || !app.trackName) return null;
  return {
    rivalId: slugify(app.trackName),
    name: app.trackName,
    appleAppId: String(app.trackId),
    seller: app.sellerName ?? "",
    domain: app.sellerUrl ?? null,
    formattedPrice: app.formattedPrice ?? "",
    isFree: (app.price ?? 0) === 0,
    ratingCount: app.userRatingCount ?? 0,
    averageRating: app.averageUserRating ?? 0,
    releaseDate: (app.releaseDate ?? "").slice(0, 10),
    lastUpdated: (app.currentVersionReleaseDate ?? "").slice(0, 10),
    foundVia,
  };
}

/**
 * The store returns things that merely mention a search term. A first run for a
 * Mac cleaner listed WhatsApp Messenger as a rival, at position 10 of one term,
 * and a report that says that is not believed on anything else it says.
 *
 * So a result has to earn its place: appear under two or more of the product's
 * terms, or reach the top of a single one.
 *
 * TOP_FOR_ONE_TERM is chosen, not measured. Five keeps "Device Monitor" at
 * position 1 for "system monitor mac", which is a real adjacent product, and
 * drops WhatsApp at position 10. Measure it once several products have run and
 * move it.
 */
const TOP_FOR_ONE_TERM = 5;

export function isRelevant(foundVia: readonly { term: string; position: number }[]): boolean {
  if (foundVia.length >= 2) return true;
  const only = foundVia[0];
  return only !== undefined && only.position <= TOP_FOR_ONE_TERM;
}

/**
 * Finds rivals by searching what a buyer would type.
 *
 * A rival that appears under several terms is more central to the category than
 * one that appears under a single term, so every term that surfaced it is kept
 * with its position. The ordering uses that before it uses rating count, which
 * stops a large adjacent application from outranking the direct rival.
 */
export async function discoverRivals(product: Product, limitPerTerm = 12): Promise<Rival[]> {
  const found = new Map<string, { app: AppleApp; via: { term: string; position: number }[] }>();

  for (const term of product.searchTerms) {
    const url =
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}` +
      `&country=${product.market}&entity=${product.storeEntity}&limit=${limitPerTerm}`;
    const payload = (await getJson(url)) as { results?: AppleApp[] } | null;
    const results = payload?.results ?? [];

    results.forEach((app, index) => {
      if (!app.trackId || isOurOwnProduct(app, product)) return;
      const key = String(app.trackId);
      const existing = found.get(key);
      if (existing) {
        existing.via.push({ term, position: index + 1 });
        return;
      }
      found.set(key, { app, via: [{ term, position: index + 1 }] });
    });
  }

  const rivals: Rival[] = [];
  for (const entry of found.values()) {
    if (!isRelevant(entry.via)) continue;
    const rival = toRival(entry.app, entry.via);
    if (rival) rivals.push(rival);
  }

  return rivals.sort((left, right) => {
    if (right.foundVia.length !== left.foundVia.length) {
      return right.foundVia.length - left.foundVia.length;
    }
    return right.ratingCount - left.ratingCount;
  });
}

export async function lookupApp(appId: string, market: string): Promise<AppleApp | null> {
  const payload = (await getJson(
    `https://itunes.apple.com/lookup?id=${appId}&country=${market}`,
  )) as { results?: AppleApp[] } | null;
  return payload?.results?.[0] ?? null;
}

export async function collectReviews(appId: string, market: string): Promise<Review[]> {
  const all: Review[] = [];
  for (let page = 1; page <= REVIEW_PAGES; page += 1) {
    const payload = (await getJson(
      `https://itunes.apple.com/${market}/rss/customerreviews/page=${page}/id=${appId}/sortby=mostrecent/json`,
    )) as { feed?: { entry?: unknown } } | null;
    const entries = payload?.feed?.entry;
    if (!Array.isArray(entries)) break;

    const reviews = entries
      .map((entry) => {
        const record = entry as Record<string, { label?: string } | undefined>;
        return {
          appId,
          rating: Number(record["im:rating"]?.label ?? 0),
          title: record["title"]?.label ?? "",
          body: record["content"]?.label ?? "",
          version: record["im:version"]?.label ?? "",
          updated: record["updated"]?.label ?? "",
        };
      })
      .filter((review) => review.rating > 0);

    if (reviews.length === 0) break;
    all.push(...reviews);
  }
  return all;
}
