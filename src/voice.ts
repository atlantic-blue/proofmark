/**
 * Groups a rival's low star reviews into complaint themes and counts them.
 *
 * The count is the useful part. One angry review is an anecdote. A theme
 * carrying half of a rival's one star reviews is a market position, and it can
 * be put next to a proposed advertisement as evidence.
 *
 * A review can carry more than one theme, so the shares do not add to a hundred.
 *
 * The themes below are general to consumer applications. A category that needs
 * its own themes should add them here rather than in a product file, because a
 * theme that only one product uses cannot be compared across products.
 */

import type { ComplaintTheme, Review, VoiceOfCustomer } from "./types.ts";

interface Theme {
  readonly name: string;
  readonly patterns: readonly RegExp[];
}

export const THEMES: readonly Theme[] = [
  {
    name: "money and subscription",
    patterns: [
      /subscri/i, /\bcharg(e|ed|ing)\b/i, /refund/i, /free trial/i, /paywall/i,
      /\bcancel/i, /auto.?renew/i, /rip.?off/i, /\bscam\b/i, /money back/i,
      /£\d/i, /\$\d/i, /expensive/i,
    ],
  },
  {
    name: "paid but locked out",
    patterns: [/lifetime/i, /premium.{0,25}(not|won't|wont|didn't|didnt|never)/i, /restore purchase/i],
  },
  {
    name: "accuracy",
    patterns: [/inaccurate/i, /not accurate/i, /accuracy/i, /\bwrong\b/i, /didn.?t (detect|pick up|record)/i, /doesn.?t (detect|pick up|work|record)/i],
  },
  {
    name: "lost work or data",
    patterns: [/lost (my |all |the )?(data|recording|history|file)/i, /didn.?t save/i, /disappear/i, /deleted/i, /stopped recording/i],
  },
  { name: "battery and heat", patterns: [/batter/i, /drain/i, /overheat/i] },
  { name: "crashes and bugs", patterns: [/crash/i, /\bbug\b/i, /freeze/i, /froze/i, /update (broke|ruined|killed)/i] },
  { name: "sync and backup", patterns: [/sync/i, /icloud/i, /backup/i, /back up/i] },
  { name: "advertising inside the product", patterns: [/\bads?\b/i, /advert/i, /pop.?up/i] },
  { name: "support never answered", patterns: [/no (reply|response|answer)/i, /support.{0,30}(never|no|useless)/i, /customer service/i] },
  { name: "hard to use", patterns: [/confus/i, /complicated/i, /hard to (use|find|figure)/i, /not intuitive/i, /clunky/i] },
  { name: "privacy and permissions", patterns: [/privacy/i, /\bdata\b.{0,20}(sold|shared|third)/i, /permission/i] },
];

const MAX_QUOTES = 4;
const QUOTE_CHARS = 230;

export function themesFor(text: string): string[] {
  return THEMES.filter((theme) => theme.patterns.some((pattern) => pattern.test(text))).map(
    (theme) => theme.name,
  );
}

export function summariseVoice(rivalId: string, reviews: readonly Review[]): VoiceOfCustomer {
  const low = reviews.filter((review) => review.rating <= 2);
  const counts = new Map<string, { count: number; quotes: string[] }>();

  for (const review of low) {
    const text = `${review.title}. ${review.body}`;
    for (const name of themesFor(text)) {
      const entry = counts.get(name) ?? { count: 0, quotes: [] };
      entry.count += 1;
      if (entry.quotes.length < MAX_QUOTES) {
        entry.quotes.push(
          `${review.title.trim()}: ${review.body.replace(/\s+/g, " ").trim().slice(0, QUOTE_CHARS)}`,
        );
      }
      counts.set(name, entry);
    }
  }

  const themes: ComplaintTheme[] = [...counts.entries()]
    .map(([name, entry]) => ({
      name,
      count: entry.count,
      share: low.length === 0 ? 0 : Math.round((entry.count / low.length) * 100),
      quotes: entry.quotes,
    }))
    .sort((left, right) => right.count - left.count);

  return { rivalId, reviewsRead: reviews.length, lowReviews: low.length, themes };
}
