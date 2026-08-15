/**
 * Renders a distribution picture as one self contained page.
 *
 * No script, no network, no build step. Every bar is a div with an inline width,
 * so the page works from a file, from a bucket, or anywhere that renders markup.
 * A report that needs a server to be read does not get read.
 *
 * The flight chart is the centre of it. "How long do these run" is answered by
 * seeing the bursts on one axis, not by reading a column of numbers.
 */

import type { Ad, DistributionPicture, MarketReading, ProvenHook } from "./types.ts";
import { parseLibraryDate } from "./meta.ts";
import { byAdvertiser, byPressure, marketMatrix, pressurePer10k, summariseSweep } from "./markets.ts";
import type { MatrixRow } from "./markets.ts";

const MAX_HOOKS = 14;
const MAX_RIVALS = 14;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface Span {
  readonly start: Date;
  readonly end: Date;
}

export function spanOf(ad: Ad, readAt: Date): Span | null {
  const start = ad.startedRunning ? parseLibraryDate(ad.startedRunning) : null;
  if (!start) return null;
  const end = ad.ended ? parseLibraryDate(ad.ended) : readAt;
  return { start, end: end ?? readAt };
}

/**
 * Places a run on the shared axis as a percentage, so a bar needs no script and
 * no measurement. A run of a single day would otherwise be invisible, so every
 * bar keeps a floor of half a per cent.
 */
export function barGeometry(span: Span, axis: Span): { left: number; width: number } {
  const total = axis.end.getTime() - axis.start.getTime();
  if (total <= 0) return { left: 0, width: 100 };
  const left = Math.max(0, Math.min(100, ((span.start.getTime() - axis.start.getTime()) / total) * 100));
  const width = ((span.end.getTime() - span.start.getTime()) / total) * 100;
  return { left, width: Math.max(0.5, Math.min(100 - left, width)) };
}

export function axisOf(ads: readonly Ad[], readAt: Date): Span | null {
  const spans = ads.map((ad) => spanOf(ad, readAt)).filter((span): span is Span => span !== null);
  if (spans.length === 0) return null;
  return {
    start: new Date(Math.min(...spans.map((span) => span.start.getTime()))),
    end: new Date(Math.max(...spans.map((span) => span.end.getTime()))),
  };
}

function monthLabel(date: Date): string {
  return date.toLocaleString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function monthTicks(axis: Span): Date[] {
  const ticks: Date[] = [];
  const cursor = new Date(Date.UTC(axis.start.getUTCFullYear(), axis.start.getUTCMonth(), 1));
  while (cursor <= axis.end) {
    if (cursor >= axis.start) ticks.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return ticks;
}

export function statCard(value: string, label: string): string {
  return `<div class="stat"><div class="stat-value">${escapeHtml(value)}</div><div class="stat-label">${escapeHtml(label)}</div></div>`;
}

/** Takes the advertisements rather than the picture, so one rival's page can plot only theirs. */
export function flightChart(ads: readonly Ad[], readAtIso: string): string {
  const readAt = new Date(readAtIso);
  const axis = axisOf(ads, readAt);
  if (!axis) return `<p class="empty">No advertisement carried a date, so there is nothing to plot.</p>`;

  const advertisers = [...new Set(ads.map((ad) => ad.advertiser ?? "unknown"))];
  const rows = ads
    .map((ad) => ({ ad, span: spanOf(ad, readAt) }))
    .filter((entry): entry is { ad: Ad; span: Span } => entry.span !== null)
    .sort((left, right) => left.span.start.getTime() - right.span.start.getTime())
    .map(({ ad, span }) => {
      const { left, width } = barGeometry(span, axis);
      const tone = advertisers.indexOf(ad.advertiser ?? "unknown") % 4;
      const title = `${ad.advertiser ?? "unknown"}: ${ad.startedRunning} to ${ad.ended ?? "still running"}, ${ad.daysLive} days, ${ad.creativeShareCount} creatives, ${ad.format}`;
      return (
        `<div class="flight-row"><a class="flight-bar tone-${tone}${ad.active ? " live" : ""}" ` +
        `style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" ` +
        `href="${escapeHtml(ad.libraryUrl)}" target="_blank" rel="noopener" title="${escapeHtml(title)}">` +
        `<span class="sr">${escapeHtml(title)}</span></a></div>`
      );
    });

  const ticks = monthTicks(axis)
    .map((tick) => {
      const { left } = barGeometry({ start: tick, end: tick }, axis);
      return `<span class="tick" style="left:${left.toFixed(2)}%">${escapeHtml(monthLabel(tick))}</span>`;
    })
    .join("");

  const key =
    advertisers
      .map((name, index) => `<span class="key-item"><i class="swatch tone-${index % 4}"></i>${escapeHtml(name)}</span>`)
      .join("") + `<span class="key-item"><i class="swatch live-swatch"></i>still running</span>`;

  return `<div class="chart">
      <div class="chart-key">${key}</div>
      <div class="flight">${rows.join("")}</div>
      <div class="axis">${ticks}</div>
    </div>`;
}

export function hookCard(hook: ProvenHook, topCreatives: number): string {
  const share = topCreatives > 0 ? Math.round((hook.creatives / topCreatives) * 100) : 0;
  const copy =
    hook.copy.length > 0
      ? `<p class="copy">${escapeHtml(hook.copy)}</p>`
      : `<p class="copy muted">No caption. The creative carries the whole message.</p>`;
  const media = hook.exampleMedia[0];
  const window = hook.firstSeen && hook.lastSeen ? `${hook.firstSeen} to ${hook.lastSeen}` : "dates not given";

  return `<article class="hook">
      <div class="hook-scale">
        <div class="hook-count">${hook.creatives}</div>
        <div class="hook-count-label">creatives</div>
        <div class="scale-track"><div class="scale-fill" style="width:${share}%"></div></div>
      </div>
      <div class="hook-body">
        <div class="hook-meta">
          <strong>${escapeHtml(hook.advertiser)}</strong>
          ${hook.formats.map((format) => `<span class="chip">${escapeHtml(format)}</span>`).join("")}
          ${hook.stillRunning ? `<span class="chip chip-live">still running</span>` : ""}
        </div>
        ${copy}
        <div class="hook-facts">
          <span>${hook.runs} ${hook.runs === 1 ? "run" : "runs"}</span>
          <span>longest ${hook.longestRunDays ?? "?"} days</span>
          <span>${escapeHtml(window)}</span>
        </div>
        <div class="hook-links">
          <a href="${escapeHtml(hook.exampleUrl)}" target="_blank" rel="noopener">Open in the ad library</a>
          ${media ? `<a href="${escapeHtml(media)}" target="_blank" rel="noopener">View the creative</a>` : ""}
        </div>
      </div>
    </article>`;
}

const MAX_PRESSURE_ROWS = 12;

/**
 * A bar with no measurement and no script. Ratings run on a square root scale
 * because one market usually holds most of the customers, and on a linear scale
 * every other market flattens into a line. The scale is named on the page, since
 * a reader comparing two bars deserves to know they are not comparing distances.
 */
export function bar(value: number, max: number, tone: string, root: boolean): string {
  if (max <= 0) return `<span class="bar-track"></span>`;
  const share = root ? Math.sqrt(value) / Math.sqrt(max) : value / max;
  const width = Math.max(value > 0 ? 1.5 : 0, Math.min(100, share * 100));
  return `<span class="bar-track"><span class="bar-fill ${tone}" style="width:${width.toFixed(2)}%"></span></span>`;
}

/**
 * One measure, one column per rival, one row per market.
 *
 * Three cells per rival, always: a bar, then a number that carries the state.
 * Putting "none" in the number cell rather than in place of the bar keeps the
 * cell count fixed, so a narrow screen can drop the bars and still leave whole
 * columns. A row that loses cells wraps, and a wrapped row puts a count under
 * the wrong country.
 */
function matrix(
  rows: readonly MatrixRow[],
  columns: readonly { advertiserId: string; name: string; tone: number }[],
  measure: "ratings" | "liveAds",
  heading: string,
): string {
  const values = rows.flatMap((row) => row.cells.map((cell) => cell?.[measure] ?? 0));
  const max = Math.max(...values, 0);
  const root = measure === "ratings";
  // Declared as custom properties on the list rather than inline on each row.
  // An inline grid template on the row would outrank the narrow screen rule and
  // the layout would never respond.
  const template =
    `--cols:34px ${columns.map(() => "1fr 62px").join(" ")};` +
    `--cols-narrow:34px ${columns.map(() => "62px").join(" ")}`;

  const body = rows
    .map((row) => {
      const cells = row.cells
        .map((cell, column) => {
          const value = cell?.[measure] ?? null;
          const label =
            value === null
              ? `<span class="market-none">unread</span>`
              : value === 0
                ? `<span class="market-none">none</span>`
                : measure === "ratings"
                  ? value.toLocaleString("en-GB")
                  : String(value);
          const track =
            value === null || value === 0
              ? `<span class="bar-track"></span>`
              : bar(value, max, `tone-${column % 4}`, root);
          return `${track}<span class="market-num">${label}</span>`;
        })
        .join("");
      return `<li><span class="market-cc">${escapeHtml(row.market)}</span>${cells}</li>`;
    })
    .join("");

  const key = columns
    .map(
      (column) =>
        `<span class="key-item"><i class="swatch tone-${column.tone % 4}"></i>${escapeHtml(column.name)}</span>`,
    )
    .join("");

  return `<h3>${escapeHtml(heading)}</h3>
    <div class="chart-key">${key}</div>
    <ul class="markets" style="${template}">${body}</ul>`;
}

/**
 * Where each rival's customers are, against where each rival is buying.
 *
 * Every matched rival gets a column, because one rival on its own is not a
 * comparison. The first version of this section showed only the closest rival,
 * which for Hush Log is SnoreLab, and SnoreLab is dark in all forty markets. The
 * published page therefore said nothing at all while ShutEye's thirty market
 * campaign sat unread one row down the list.
 *
 * Both readings go on the page, including the one that argues with the other,
 * because raw counts and counts divided by the customer base put the same market
 * in opposite halves of the list. Showing only the flattering one is a way of
 * lying with two true numbers.
 */
function marketSection(picture: DistributionPicture): string {
  const sweep = picture.marketSweep ?? [];
  if (sweep.length === 0) return "";

  const grouped = byAdvertiser(sweep);
  const columns = [...grouped.keys()].map((advertiserId, index) => ({
    advertiserId,
    name: picture.advertisers.find((entry) => entry.advertiserId === advertiserId)?.name ?? advertiserId,
    tone: index,
  }));
  const rows = marketMatrix(sweep, columns.map((column) => column.advertiserId));
  const home = picture.product.market.toUpperCase();

  const perRival = columns.map((column) => {
    const readings = grouped.get(column.advertiserId) ?? [];
    const summary = summariseSweep(readings);
    const homeReading = readings.find((entry) => entry.market === home) ?? null;
    return { column, readings, summary, homeReading };
  });

  const standings = perRival
    .map(({ column, summary, homeReading }) => {
      const live =
        summary.marketsWithAds === 0
          ? "runs nothing anywhere today"
          : `live in ${summary.marketsWithAds} of ${summary.marketsRead} markets, busiest ${escapeHtml(summary.busiest?.market ?? "")} at ${summary.busiest?.liveAds ?? 0}`;
      const base = summary.largestBase
        ? `largest base ${escapeHtml(summary.largestBase.market)} at ${(summary.largestBase.ratings ?? 0).toLocaleString("en-GB")}`
        : "no store listing found";
      const here =
        homeReading?.liveAds === null || homeReading === null
          ? `${escapeHtml(home)} unread`
          : `${homeReading.liveAds} in ${escapeHtml(home)}`;
      return `<li><span class="rival-name"><i class="swatch tone-${column.tone % 4}"></i> ${escapeHtml(column.name)}</span><span class="rival-note">${live} &middot; ${base} &middot; ${here}</span></li>`;
    })
    .join("");

  // The counter reading only says something about a rival that is actually
  // buying, so it is drawn for the busiest one and named rather than blended.
  const busiest = [...perRival].sort(
    (left, right) => right.summary.marketsWithAds - left.summary.marketsWithAds,
  )[0];
  const pressure = busiest ? byPressure(busiest.readings) : [];
  const maxPressure = pressure[0] ? (pressurePer10k(pressure[0]) ?? 0) : 0;
  const homeRank = busiest?.homeReading
    ? pressure.findIndex((entry) => entry.market === home) + 1
    : 0;
  const homePressure = busiest?.homeReading ? pressurePer10k(busiest.homeReading) : null;

  const pressureRows = pressure
    .slice(0, MAX_PRESSURE_ROWS)
    .concat(homeRank > MAX_PRESSURE_ROWS && busiest?.homeReading ? [busiest.homeReading] : [])
    .map((entry) => {
      const value = pressurePer10k(entry) ?? 0;
      return `<li>
        <span class="market-cc">${escapeHtml(entry.market)}</span>
        ${bar(value, maxPressure, `tone-${(busiest?.column.tone ?? 0) % 4}`, false)}
        <span class="market-num">${value.toFixed(1)}</span>
      </li>`;
    })
    .join("");

  const quiet = (busiest?.summary.quietWithCustomers ?? [])
    .slice(0, 8)
    .map((entry) => `${escapeHtml(entry.market)} (${(entry.ratings ?? 0).toLocaleString("en-GB")})`)
    .join(", ");

  return `<section>
    <h2>Where their market is</h2>
    <p class="lede">${columns.length === 1 ? "One rival" : `${columns.length} rivals`} counted in ${rows.length} markets each. Advertisements say where they are buying today. Ratings say where their customers already are. The two do not sit in the same places, and watching one country is how the wrong one gets watched.</p>
    <ul class="rivals">${standings}</ul>
    ${matrix(rows, columns, "liveAds", "Who is buying where, today")}
    ${matrix(rows, columns, "ratings", "Where the customers already are (square root scale)")}
    ${
      pressureRows
        ? `<h3>The reading that argues with it: ${escapeHtml(busiest?.column.name ?? "")} advertisements per 10,000 ratings</h3>
    <p class="lede">Raw counts favour a big country. Dividing one by the other reorders the list completely. A market with a small base scores high on a handful of advertisements, so this reading has its own distortion, and it is here to stop the first one being read alone.${homePressure !== null && homeRank > 0 ? ` ${escapeHtml(home)} ranks ${homeRank} of ${pressure.length} on it, at ${homePressure.toFixed(1)}.` : ""}</p>
    <ul class="markets markets-narrow">${pressureRows}</ul>`
        : ""
    }
    ${quiet ? `<p class="caveat">${escapeHtml(busiest?.column.name ?? "")} has customers and no campaign in: ${quiet}. An absent campaign is not an absent audience.</p>` : ""}
    <p class="caveat">Neither number is money. An advertisement count counts objects, and a buyer can spend more on twelve than on seventy. A rating count is a lifetime total that only rises, so it describes the installed base rather than demand this month. The library publishes no spend and no impressions for a commercial advertiser.</p>
  </section>`;
}

function priceSection(picture: DistributionPicture): string {
  // A rival matched to an advertiser account has a page of its own, so its name
  // is a link. One that is not matched has nothing behind it, and a link to an
  // empty page is worse than no link.
  const hasPage = new Set(picture.advertisers.map((advertiser) => advertiser.rivalId));
  const rows = picture.rivals
    .slice(0, MAX_RIVALS)
    .map(
      (rival) =>
        `<li><span class="rival-name">${
          hasPage.has(rival.rivalId)
            ? `<a href="./${escapeHtml(rival.rivalId)}/">${escapeHtml(rival.name)}</a>`
            : escapeHtml(rival.name)
        }</span>` +
        `<span class="chip ${rival.isFree ? "chip-free" : "chip-paid"}">${escapeHtml(rival.formattedPrice || "unknown")}</span>` +
        `<span class="rival-note">${rival.ratingCount > 0 ? `${rival.ratingCount.toLocaleString("en-GB")} ratings` : "ratings not published"}${rival.lastUpdated ? `, updated ${escapeHtml(rival.lastUpdated)}` : ""}</span></li>`,
    )
    .join("");

  const free = picture.rivals.filter((rival) => rival.isFree).length;
  const verdict =
    free === picture.rivals.length && free > 0
      ? "Every rival found is free to install."
      : `${free} of ${picture.rivals.length} rivals are free to install.`;

  return `<section><h2>How the category sells</h2><p class="lede">${escapeHtml(verdict)}</p><ul class="rivals">${rows}</ul></section>`;
}

function buySection(picture: DistributionPicture): string {
  const byRival = new Map(picture.rivals.map((rival) => [rival.rivalId, rival.name]));
  const rows = picture.presence
    .map((presence) => {
      const platforms = presence.advertisingPlatforms.length
        ? presence.advertisingPlatforms.map((name) => `<span class="chip">${escapeHtml(name)}</span>`).join("")
        : `<span class="chip chip-none">nothing found</span>`;
      const attribution = presence.attributionProviders
        .map((name) => `<span class="chip chip-attr">${escapeHtml(name)}</span>`)
        .join("");
      return `<li><span class="rival-name">${escapeHtml(byRival.get(presence.rivalId) ?? presence.rivalId)}</span><span class="chips">${platforms}${attribution}</span></li>`;
    })
    .join("");

  const confirmed = picture.advertisers
    .map(
      (advertiser) =>
        `<li><span class="rival-name">${escapeHtml(advertiser.name)}</span><span class="chips">` +
        `<span class="chip chip-confirmed">${escapeHtml(advertiser.matchConfidence)} on ${escapeHtml(advertiser.platform)}</span>` +
        `<span class="chip">at least ${advertiser.activeAdCountAtLeast} active</span></span></li>`,
    )
    .join("");

  return `<section><h2>Where they buy</h2>
    <p class="lede">Read from each rival's own site and the public tag container behind it. A pixel is not proof of spend. It is proof that somebody built the measurement, which nobody does for a platform they never buy on.</p>
    <ul class="rivals">${rows}</ul>
    ${confirmed ? `<h3>Confirmed in the advertisement library</h3><ul class="rivals">${confirmed}</ul>` : ""}
    <p class="caveat">A site pixel says where a company measures web conversions. An application install campaign needs no web pixel at all. And Apple Search Ads publishes no library, so nothing here can confirm or deny that any rival uses it.</p>
  </section>`;
}

function voiceSection(picture: DistributionPicture): string {
  const byRival = new Map(picture.rivals.map((rival) => [rival.rivalId, rival.name]));
  const totals = new Map<string, number>();
  let low = 0;
  for (const voice of picture.voice) {
    low += voice.lowReviews;
    for (const theme of voice.themes) totals.set(theme.name, (totals.get(theme.name) ?? 0) + theme.count);
  }
  const ranked = [...totals.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6);
  const top = ranked[0];

  const bars = ranked
    .map(
      ([name, count]) =>
        `<li><span class="theme-name">${escapeHtml(name)}</span>` +
        `<span class="theme-track"><span class="theme-fill" style="width:${low > 0 ? Math.round((count / low) * 100) : 0}%"></span></span>` +
        `<span class="theme-count">${count}</span></li>`,
    )
    .join("");

  const quotes = picture.voice
    .flatMap((voice) => {
      const theme = voice.themes.find((candidate) => candidate.name === top?.[0]);
      return (theme?.quotes ?? [])
        .slice(0, 1)
        .map(
          (quote) =>
            `<figure class="quote"><p class="quote-text">${escapeHtml(quote)}</p><figcaption>${escapeHtml(byRival.get(voice.rivalId) ?? voice.rivalId)}</figcaption></figure>`,
        );
    })
    .slice(0, 4)
    .join("");

  const headline =
    top && low > 0
      ? `${low.toLocaleString("en-GB")} reviews at one or two stars across ${picture.voice.length} rivals. The largest single theme is ${top[0]}, in ${top[1]} of them, which is ${Math.round((top[1] / low) * 100)} per cent.`
      : "No low star reviews were collected.";

  return `<section><h2>What their customers are angry about</h2>
    <p class="lede">${escapeHtml(headline)}</p>
    <ul class="themes">${bars}</ul>
    ${quotes}
  </section>`;
}

function bidsSection(picture: DistributionPicture): string {
  const byAdvertiser = new Map<string, { name: string; terms: Set<string>; total: number }>();
  for (const entry of picture.categoryAdvertisers) {
    const seen = byAdvertiser.get(entry.advertiserId) ?? { name: entry.name, terms: new Set<string>(), total: 0 };
    seen.terms.add(entry.term);
    seen.total = Math.max(seen.total, entry.count);
    byAdvertiser.set(entry.advertiserId, seen);
  }
  const matched = new Set(picture.advertisers.map((advertiser) => advertiser.advertiserId));
  const across = [...byAdvertiser.entries()]
    .filter(([, seen]) => seen.terms.size > 1)
    .sort((left, right) => right[1].terms.size - left[1].terms.size || right[1].total - left[1].total)
    .slice(0, 12);

  const rows = across.length
    ? across
        .map(
          ([id, seen]) =>
            `<li><span class="rival-name">${escapeHtml(seen.name)}${matched.has(id) ? ` <span class="chip chip-confirmed">a rival we track</span>` : ""}</span>` +
            `<span class="rival-note">${seen.terms.size} terms, up to ${seen.total} ads. ${escapeHtml([...seen.terms].sort().join(", "))}</span></li>`,
        )
        .join("")
    : `<li><span class="rival-note">No advertiser appeared under more than one term, which is itself worth knowing.</span></li>`;

  return `<section><h2>Who else bids on these words</h2>
    <p class="lede">${byAdvertiser.size} advertisers across ${new Set(picture.categoryAdvertisers.map((entry) => entry.term)).size} search terms. The count saturates at ten, so ten means ten or more.</p>
    <h3>Seen under more than one term</h3>
    <ul class="rivals">${rows}</ul>
    <p class="caveat">The other ${byAdvertiser.size - across.length} appeared under a single term. In consumer categories that tail is usually unrelated: story and drama accounts whose copy happens to contain the word.</p>
  </section>`;
}

export const STYLES = `
:root {
  --ground: #EDF0EF; --surface: #FFFFFF; --surface-sunk: #E4E9E7; --line: #CBD5D2;
  --text: #16211F; --text-soft: #55635F; --accent: #0F7A6C; --accent-soft: #D3E7E2; --warn: #B5721B;
  --tone-0: #0F7A6C; --tone-1: #3E6B8A; --tone-2: #8A5A7A; --tone-3: #6B7A3E;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, ui-serif, serif;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #0E1618; --surface: #152023; --surface-sunk: #0A1113; --line: #24343A;
    --text: #DEE7E5; --text-soft: #8A9C99; --accent: #4FC4B0; --accent-soft: #133831; --warn: #D9974A;
    --tone-0: #4FC4B0; --tone-1: #6FA3C9; --tone-2: #C08BAF; --tone-3: #A7B96E;
  }
}
:root[data-theme="dark"] {
  --ground: #0E1618; --surface: #152023; --surface-sunk: #0A1113; --line: #24343A;
  --text: #DEE7E5; --text-soft: #8A9C99; --accent: #4FC4B0; --accent-soft: #133831; --warn: #D9974A;
  --tone-0: #4FC4B0; --tone-1: #6FA3C9; --tone-2: #C08BAF; --tone-3: #A7B96E;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--ground); color: var(--text); font-family: var(--sans); font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
.wrap { max-width: 1040px; margin: 0 auto; padding: 48px 24px 96px; display: flex; flex-direction: column; gap: 44px; }
header { display: flex; flex-direction: column; gap: 10px; }
.eyebrow { font-family: var(--mono); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
h1 { font-family: var(--serif); font-weight: 600; font-size: clamp(30px, 5vw, 46px); line-height: 1.12; margin: 0; text-wrap: balance; }
.subtitle { color: var(--text-soft); max-width: 62ch; margin: 0; }
.provenance { font-family: var(--mono); font-size: 12.5px; color: var(--text-soft); border-top: 1px solid var(--line); padding-top: 10px; margin: 4px 0 0; }
h2 { font-family: var(--serif); font-weight: 600; font-size: 25px; margin: 0 0 6px; text-wrap: balance; }
h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .09em; color: var(--text-soft); margin: 26px 0 10px; font-weight: 600; }
.lede { color: var(--text-soft); max-width: 68ch; margin: 0 0 18px; }
.caveat { font-size: 14px; color: var(--text-soft); border-left: 2px solid var(--warn); padding-left: 14px; margin: 20px 0 0; max-width: 68ch; }
section { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 28px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
.stat { background: var(--surface); padding: 18px 16px; }
.stat-value { font-family: var(--mono); font-size: 26px; font-variant-numeric: tabular-nums; line-height: 1.1; }
.stat-label { font-size: 12px; color: var(--text-soft); margin-top: 4px; }
.chart { display: flex; flex-direction: column; gap: 12px; }
.chart-key { display: flex; flex-wrap: wrap; gap: 16px; font-size: 12.5px; color: var(--text-soft); }
.key-item { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
.swatch.tone-0 { background: var(--tone-0); } .swatch.tone-1 { background: var(--tone-1); }
.swatch.tone-2 { background: var(--tone-2); } .swatch.tone-3 { background: var(--tone-3); }
.live-swatch { background: transparent; box-shadow: inset 0 0 0 1px var(--text); }
.flight { display: flex; flex-direction: column; gap: 3px; background: var(--surface-sunk); border-radius: 3px; padding: 10px 8px; }
.flight-row { position: relative; height: 11px; }
.flight-bar { position: absolute; top: 0; height: 11px; border-radius: 2px; display: block; opacity: .92; }
.flight-bar:hover, .flight-bar:focus-visible { opacity: 1; outline: 2px solid var(--text); outline-offset: 1px; }
.flight-bar.tone-0 { background: var(--tone-0); } .flight-bar.tone-1 { background: var(--tone-1); }
.flight-bar.tone-2 { background: var(--tone-2); } .flight-bar.tone-3 { background: var(--tone-3); }
.flight-bar.live { box-shadow: inset 0 0 0 1px var(--text); }
.axis { position: relative; height: 18px; font-family: var(--mono); font-size: 11px; color: var(--text-soft); }
.tick { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.hooks { display: flex; flex-direction: column; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
.hook { display: grid; grid-template-columns: 120px 1fr; gap: 20px; background: var(--surface); padding: 20px; }
.hook-scale { display: flex; flex-direction: column; gap: 2px; }
.hook-count { font-family: var(--mono); font-size: 30px; font-variant-numeric: tabular-nums; line-height: 1; color: var(--accent); }
.hook-count-label { font-size: 11.5px; color: var(--text-soft); text-transform: uppercase; letter-spacing: .07em; }
.scale-track { height: 4px; background: var(--surface-sunk); border-radius: 2px; margin-top: 8px; }
.scale-fill { height: 4px; background: var(--accent); border-radius: 2px; }
.hook-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
.copy { font-family: var(--serif); font-size: 18.5px; line-height: 1.45; margin: 0 0 10px; max-width: 60ch; }
.copy.muted { color: var(--text-soft); font-style: italic; font-size: 16px; }
.hook-facts { display: flex; flex-wrap: wrap; gap: 14px; font-family: var(--mono); font-size: 12px; color: var(--text-soft); }
.hook-links { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 10px; font-size: 13.5px; }
a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
.chip { font-family: var(--mono); font-size: 11.5px; padding: 2px 7px; border-radius: 3px; background: var(--surface-sunk); color: var(--text-soft); white-space: nowrap; }
.chip-live, .chip-confirmed, .chip-free { background: var(--accent-soft); color: var(--accent); }
.chip-paid { background: var(--warn); color: var(--surface); }
.chip-none { opacity: .7; }
.chip-attr { border: 1px solid var(--line); background: transparent; }
.rivals { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.rivals li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.rivals li:last-child { border-bottom: 0; }
.rival-name { font-weight: 600; }
.rival-note { font-family: var(--mono); font-size: 12px; color: var(--text-soft); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.markets { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.markets li { display: grid; grid-template-columns: var(--cols, 30px 1fr 62px); gap: 10px; align-items: center; }
.markets.markets-narrow li { grid-template-columns: 30px 1fr 54px; }
.market-cc { font-family: var(--mono); font-size: 12px; letter-spacing: .06em; color: var(--text-soft); }
.bar-track { display: block; height: 9px; background: var(--surface-sunk); border-radius: 2px; }
.bar-fill { display: block; height: 9px; border-radius: 2px; }
.bar-fill.tone-0 { background: var(--tone-0); } .bar-fill.tone-1 { background: var(--tone-1); }
.bar-fill.tone-2 { background: var(--tone-2); } .bar-fill.tone-3 { background: var(--tone-3); }
.rival-name .swatch { margin-right: 2px; vertical-align: baseline; }
.market-num { font-family: var(--mono); font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; color: var(--text-soft); }
.market-none { font-family: var(--mono); font-size: 11px; color: var(--text-soft); opacity: .75; white-space: nowrap; }
/* Below this width five columns do not fit, so the bars go and the numbers stay.
   Dropping cells instead would wrap a row and put a count under another country. */
@media (max-width: 720px) {
  .markets:not(.markets-narrow) li { grid-template-columns: var(--cols-narrow, 30px 62px); }
  .markets:not(.markets-narrow) li > .bar-track { display: none; }
}
.themes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.themes li { display: grid; grid-template-columns: minmax(140px, 210px) 1fr 46px; gap: 12px; align-items: center; }
.theme-name { font-size: 14px; }
.theme-track { height: 9px; background: var(--surface-sunk); border-radius: 2px; }
.theme-fill { display: block; height: 9px; background: var(--accent); border-radius: 2px; }
.theme-count { font-family: var(--mono); font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; color: var(--text-soft); }
.quote { margin: 22px 0 0; border-left: 2px solid var(--line); padding-left: 16px; }
.quote-text { margin: 0; font-family: var(--serif); font-size: 16.5px; line-height: 1.5; max-width: 62ch; }
.quote figcaption { font-family: var(--mono); font-size: 11.5px; color: var(--text-soft); margin-top: 5px; }
.gaps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.gaps li { padding-left: 18px; position: relative; color: var(--text-soft); font-size: 14.5px; }
.gaps li::before { content: ""; position: absolute; left: 0; top: 9px; width: 8px; height: 2px; background: var(--warn); }
.empty { color: var(--text-soft); font-style: italic; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.index { display: flex; flex-wrap: wrap; gap: 12px; }
.index a { font-family: var(--mono); font-size: 13px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 3px; text-decoration: none; }
@media (max-width: 640px) {
  .hook { grid-template-columns: 1fr; gap: 12px; }
  .themes li { grid-template-columns: 1fr 46px; }
  .theme-track { grid-column: 1 / -1; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

export function buildSite(picture: DistributionPicture): string {
  const ads = picture.ads;
  const lengths = ads
    .map((ad) => ad.daysLive)
    .filter((days): days is number => days !== null)
    .sort((left, right) => left - right);
  const middle = lengths.length > 0 ? (lengths[Math.floor(lengths.length / 2)] as number) : 0;
  const creatives = ads.reduce((sum, ad) => sum + ad.creativeShareCount, 0);
  const live = ads.filter((ad) => ad.active).length;
  const topCreatives = picture.hooks[0]?.creatives ?? 0;
  const videos = ads.filter((ad) => ad.format === "video").length;

  const hooks = picture.hooks.slice(0, MAX_HOOKS).map((hook) => hookCard(hook, topCreatives)).join("");

  return `<title>${escapeHtml(picture.product.name)} Rival Watch</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLES}</style>
<div class="wrap">
  <header>
    <div class="eyebrow">Proofmark</div>
    <h1>What the competition does for distribution</h1>
    <p class="subtitle">${escapeHtml(picture.product.name)}: ${escapeHtml(picture.product.job)}</p>
    <p class="provenance">Read ${escapeHtml(picture.readAt.slice(0, 10))} &middot; ${escapeHtml(picture.product.market.toUpperCase())} in depth${(picture.marketSweep ?? []).length ? `, ${(picture.marketSweep ?? []).length} markets counted` : ""} &middot; searched: ${escapeHtml(picture.product.searchTerms.join(", "))}</p>
  </header>

  <div class="stats">
    ${statCard(String(picture.rivals.length), "rivals found")}
    ${statCard(String(picture.advertisers.length), "matched to an ad account")}
    ${statCard(String(ads.length), "advertisements read")}
    ${statCard(String(creatives), "creatives behind them")}
    ${statCard(String(live), "still running")}
    ${statCard(lengths.length ? `${middle}d` : "n/a", "middle run length")}
  </div>

  ${marketSection(picture)}

  <section>
    <h2>When they ran</h2>
    <p class="lede">Every advertisement captured, on one axis. Each bar is a run, an outlined bar is still live, and colour is the advertiser. Click a bar to open that advertisement in the library.</p>
    ${flightChart(picture.ads, picture.readAt)}
    ${
      lengths.length
        ? `<p class="caveat">Shortest ${lengths[0]} days, middle of the set ${middle} days, longest ${lengths[lengths.length - 1]} days, ${lengths.reduce((sum, days) => sum + days, 0)} advertisement days in total. ${videos} of ${ads.length} are video. Placement inside Meta, meaning Facebook against Instagram, is drawn as an icon with no readable label, so it is not captured yet.</p>`
        : ""
    }
  </section>

  <section>
    <h2>What they say, ranked by what they put behind it</h2>
    <p class="lede">Ranked by how many creatives share one piece of copy, not by how long an advertisement ran. In a seasonal category nobody runs a long advertisement, so length of run ranks nothing. What a company repeats is the sentence.</p>
    <div class="hooks">${hooks || `<p class="empty">No advertisement copy was captured.</p>`}</div>
  </section>

  ${priceSection(picture)}
  ${buySection(picture)}
  ${voiceSection(picture)}
  ${bidsSection(picture)}

  <section>
    <h2>What could not be read</h2>
    <ul class="gaps">${picture.gaps.map((gap) => `<li>${escapeHtml(gap)}</li>`).join("") || `<li>Nothing was skipped.</li>`}</ul>
  </section>
</div>`;
}

/** The landing page, when more than one product has a report. */
export function buildIndex(products: readonly { productId: string; name: string; readAt: string; ads: number }[]): string {
  const links = products
    .map(
      (product) =>
        `<a href="./${escapeHtml(product.productId)}/">${escapeHtml(product.name)} <span class="rival-note">${escapeHtml(product.readAt.slice(0, 10))}, ${product.ads} ads</span></a>`,
    )
    .join("");

  return `<title>Proofmark Reports</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLES}</style>
<div class="wrap">
  <header>
    <div class="eyebrow">Proofmark</div>
    <h1>What the competition does for distribution</h1>
    <p class="subtitle">One report per product. Each one reads the rivals, their advertisements, where they buy and what their customers complain about.</p>
  </header>
  <section><h2>Reports</h2><div class="index">${links || `<p class="empty">No report has been produced yet.</p>`}</div></section>
</div>`;
}
