/**
 * One page per competitor.
 *
 * The product page answers "what is the category doing". This answers "what is
 * this company doing", which is the question somebody asks second and could not
 * ask at all until now: everything about a rival was spread across five sections
 * of one page, interleaved with everything about the others.
 *
 * The order is the order the questions get asked. Who are they and can I go and
 * look. Where do they buy. What are they running. Who does it actually reach.
 * What is missing.
 *
 * Same rule as the product page: no script, no network, no build step.
 */

import {
  breakdownGap,
  deliveredTotal,
  reachByAge,
  reachByCountry,
  reachByGender,
} from "./adDetail.ts";
import { byAdvertiser, pressurePer10k, summariseSweep } from "./markets.ts";
import { bar, escapeHtml, flightChart, hookCard, statCard, STYLES } from "./site.ts";
import type { AdDetail, DistributionPicture, Rival } from "./types.ts";

const MAX_HOOKS = 8;
const MAX_COUNTRIES = 12;

/** The file name a rival's page is written to, and linked by from the product page. */
export function rivalPagePath(rival: Rival): string {
  return rival.rivalId;
}

function number(value: number): string {
  return value.toLocaleString("en-GB");
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function identity(picture: DistributionPicture, rival: Rival, details: readonly AdDetail[]): string {
  const advertiser = picture.advertisers.find((entry) => entry.rivalId === rival.rivalId);
  const payers = [...new Set(details.flatMap((detail) => detail.payers))];
  const beneficiaries = [...new Set(details.flatMap((detail) => detail.beneficiaries))];

  const rows: string[] = [
    `<li><span class="rival-name">Publisher</span><span class="rival-note">${escapeHtml(rival.seller || "not published")}</span></li>`,
    `<li><span class="rival-name">Price</span><span class="chip ${rival.isFree ? "chip-free" : "chip-paid"}">${escapeHtml(rival.formattedPrice || "unknown")}</span></li>`,
    `<li><span class="rival-name">Ratings</span><span class="rival-note">${
      rival.ratingCount > 0
        ? `${number(rival.ratingCount)} at ${rival.averageRating.toFixed(2)}`
        : "not published by Apple"
    }</span></li>`,
    `<li><span class="rival-name">First released</span><span class="rival-note">${escapeHtml(rival.releaseDate || "unknown")}</span></li>`,
    `<li><span class="rival-name">Last updated</span><span class="rival-note">${escapeHtml(rival.lastUpdated || "unknown")}</span></li>`,
    `<li><span class="rival-name">Found by searching</span><span class="rival-note">${escapeHtml(
      rival.foundVia.map((via) => `${via.term} at ${via.position}`).join(", ") || "not recorded",
    )}</span></li>`,
  ];

  // Who pays and who benefits is a credential, and the two are not always the
  // same company. It only exists on an advertisement served in the European
  // Union, so an advertiser with no European campaign has none of it.
  if (payers.length > 0) {
    rows.push(
      `<li><span class="rival-name">Pays for the advertising</span><span class="rival-note">${escapeHtml(payers.join(", "))}</span></li>`,
    );
  }
  if (beneficiaries.length > 0) {
    rows.push(
      `<li><span class="rival-name">Advertising benefits</span><span class="rival-note">${escapeHtml(beneficiaries.join(", "))}</span></li>`,
    );
  }

  const links = [
    `<a href="https://apps.apple.com/${escapeHtml(picture.product.market)}/app/id${escapeHtml(rival.appleAppId)}" target="_blank" rel="noopener">App Store listing</a>`,
    rival.domain
      ? `<a href="${escapeHtml(rival.domain)}" target="_blank" rel="noopener">Their website</a>`
      : "",
    advertiser
      ? `<a href="https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${escapeHtml(advertiser.advertiserId)}" target="_blank" rel="noopener">Their advertisement library</a>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  return `<section>
    <h2>Who they are</h2>
    <div class="hook-links">${links}</div>
    <ul class="rivals">${rows.join("")}</ul>
  </section>`;
}

function channels(picture: DistributionPicture, rival: Rival): string {
  const advertiser = picture.advertisers.find((entry) => entry.rivalId === rival.rivalId);
  const presence = picture.presence.find((entry) => entry.rivalId === rival.rivalId);

  const confirmed = advertiser
    ? `<li><span class="rival-name">Meta</span><span class="chips">` +
      `<span class="chip chip-confirmed">${escapeHtml(advertiser.matchConfidence)} account</span>` +
      `<span class="chip">${escapeHtml(advertiser.name)}</span></span></li>`
    : `<li><span class="rival-name">Meta</span><span class="chip chip-none">no account matched</span></li>`;

  const measured = presence
    ? [
        presence.advertisingPlatforms.length > 0
          ? `<li><span class="rival-name">Measured for</span><span class="chips">${presence.advertisingPlatforms
              .map((name) => `<span class="chip">${escapeHtml(name)}</span>`)
              .join("")}</span></li>`
          : `<li><span class="rival-name">Measured for</span><span class="chip chip-none">nothing found on their site</span></li>`,
        presence.attributionProviders.length > 0
          ? `<li><span class="rival-name">Attribution</span><span class="chips">${presence.attributionProviders
              .map((name) => `<span class="chip chip-attr">${escapeHtml(name)}</span>`)
              .join("")}</span></li>`
          : "",
      ].join("")
    : `<li><span class="rival-name">Their site</span><span class="chip chip-none">could not be read</span></li>`;

  return `<section>
    <h2>Where they advertise</h2>
    <p class="lede">Two kinds of evidence, and they are not equal. An account in an advertisement library is proof they buy there. A tag on their website is proof they built the measurement, which nobody does for a platform they never buy on, but it is weaker.</p>
    <ul class="rivals">${confirmed}${measured}</ul>
    <p class="caveat">Only Meta is read today. Google's Ads Transparency Center, the TikTok European library and the LinkedIn Ad Library all answer without a login and none of them is wired in yet, so an absence above is an absence of reading and not of advertising. Apple Search Ads publishes no library at all, and for an iPhone application that is often the largest channel.</p>
  </section>`;
}

function campaigns(picture: DistributionPicture, rival: Rival): string {
  const advertiser = picture.advertisers.find((entry) => entry.rivalId === rival.rivalId);
  if (!advertiser) return "";
  const ads = picture.ads.filter((ad) => ad.advertiserId === advertiser.advertiserId);
  if (ads.length === 0) {
    return `<section><h2>What they run</h2><p class="empty">No advertisement was captured for this account.</p></section>`;
  }

  const live = ads.filter((ad) => ad.active);
  const ended = ads.filter((ad) => !ad.active);
  const reused = ads.filter((ad) => ad.creativeShareCount > 1);
  const lengths = ads
    .map((ad) => ad.daysLive)
    .filter((days): days is number => days !== null)
    .sort((left, right) => left - right);

  const hooks = picture.hooks
    .filter((hook) => hook.advertiser === advertiser.name)
    .slice(0, MAX_HOOKS);
  const topCreatives = hooks[0]?.creatives ?? 0;

  return `<section>
    <h2>What they run</h2>
    <div class="stats">
      ${statCard(String(live.length), "running today")}
      ${statCard(String(ended.length), "already ended")}
      ${statCard(String(reused.length), "creatives used more than once")}
      ${statCard(lengths.length ? `${lengths[lengths.length - 1]}d` : "n/a", "longest run")}
    </div>
    <h3>Every run on one axis</h3>
    <p class="lede">Each bar is one advertisement, from the day it started to the day it ended. An outlined bar is still live. Click a bar to open it in the library.</p>
    ${flightChart(ads, picture.readAt)}
    ${
      hooks.length > 0
        ? `<h3>What they say, ranked by what they put behind it</h3>
    <div class="hooks">${hooks.map((hook) => hookCard(hook, topCreatives)).join("")}</div>`
        : ""
    }
  </section>`;
}

/**
 * The audience, which is the part nobody else publishes.
 *
 * Targeting and delivery are shown next to each other on purpose. A buyer asking
 * for everybody and a platform handing them one age band is the finding, and it
 * only appears when both numbers sit on the same line.
 */
function audience(details: readonly AdDetail[]): string {
  if (details.length === 0) return "";
  const withReach = details.filter((detail) => detail.euTotalReach !== null);
  if (withReach.length === 0) {
    return `<section><h2>Who it reached</h2><p class="empty">No advertisement of theirs was served in the European Union, so no reach, age or gender is published for them anywhere.</p></section>`;
  }

  const cards = withReach
    .map((detail) => {
      const ages = reachByAge(detail);
      const gender = reachByGender(detail);
      const countries = reachByCountry(detail).slice(0, MAX_COUNTRIES);
      const maxAge = Math.max(...ages.map((band) => band.people), 0);
      const maxCountry = Math.max(...countries.map((country) => country.people), 0);
      const gap = breakdownGap(detail);

      const target =
        detail.targetedAgeMin === null
          ? "not published"
          : `${detail.targetedAgeMin} to ${detail.targetedAgeMax ?? "?"}, ${escapeHtml(detail.targetedGender ?? "any")}, ${detail.targetedCountries.length} countries`;

      return `<article class="detail-card">
        <div class="detail-head">
          <a href="https://www.facebook.com/ads/library/?id=${escapeHtml(detail.libraryId)}" target="_blank" rel="noopener">Library ID ${escapeHtml(detail.libraryId)}</a>
          <span class="detail-reach">${number(detail.euTotalReach ?? 0)}</span>
          <span class="detail-reach-label">people reached in the European Union</span>
        </div>
        <p class="lede">Asked for ${escapeHtml(target)}. Delivered to ${percent(gender.male / (gender.total || 1))} men and ${percent(gender.female / (gender.total || 1))} women across ${detail.deliveredReach.length} countries.</p>
        <h3>Delivered by age</h3>
        <ul class="markets markets-narrow">
          ${ages
            .map(
              (band) =>
                `<li><span class="market-cc">${escapeHtml(band.ageRange)}</span>${bar(band.people, maxAge, "tone-1", false)}<span class="market-num">${percent(band.share)}</span></li>`,
            )
            .join("")}
        </ul>
        <h3>Delivered by country</h3>
        <ul class="markets markets-narrow">
          ${countries
            .map(
              (country) =>
                `<li><span class="market-cc">${escapeHtml(country.country)}</span>${bar(country.people, maxCountry, "tone-0", false)}<span class="market-num">${number(country.people)}</span></li>`,
            )
            .join("")}
        </ul>
        <p class="caveat">The stated reach is ${number(detail.euTotalReach ?? 0)} and the published cells add to ${number(deliveredTotal(detail))}, a difference of ${gap === null ? "n/a" : percent(Math.abs(gap))}. The headline counts a person once and the breakdown counts them in every country and age band they were reached in, so neither number contains the other and adding the cells up is not the reach.</p>
      </article>`;
    })
    .join("");

  return `<section>
    <h2>Who it reached</h2>
    <p class="lede">Published because the Digital Services Act requires it, which means it exists for an advertisement served in the European Union and nowhere else. There is no equivalent for Great Britain, the United States or anywhere outside the Union, and there is no spend figure anywhere at all.</p>
    ${cards}
  </section>`;
}

function marketsFor(picture: DistributionPicture, rival: Rival): string {
  const advertiser = picture.advertisers.find((entry) => entry.rivalId === rival.rivalId);
  if (!advertiser) return "";
  const readings = byAdvertiser(picture.marketSweep ?? []).get(advertiser.advertiserId) ?? [];
  if (readings.length === 0) return "";

  const summary = summariseSweep(readings);
  const live = readings
    .filter((reading) => (reading.liveAds ?? 0) > 0)
    .sort((left, right) => (right.liveAds ?? 0) - (left.liveAds ?? 0));
  const max = Math.max(...live.map((reading) => reading.liveAds ?? 0), 0);

  return `<section>
    <h2>Where they buy</h2>
    <p class="lede">${
      summary.marketsWithAds === 0
        ? `Nothing running in any of the ${summary.marketsRead} markets read.`
        : `Live in ${summary.marketsWithAds} of ${summary.marketsRead} markets read.`
    }</p>
    ${
      live.length > 0
        ? `<ul class="markets markets-narrow">${live
            .map(
              (reading) =>
                `<li><span class="market-cc">${escapeHtml(reading.market)}</span>${bar(reading.liveAds ?? 0, max, "tone-2", false)}<span class="market-num">${reading.liveAds}</span></li>`,
            )
            .join("")}</ul>`
        : ""
    }
    <p class="caveat">An advertisement count counts objects, never budget. A buyer can spend more on twelve than on seventy.</p>
  </section>`;
}

/**
 * The lines a reader would write themselves after reading the rest of the page.
 *
 * Every sentence is derived from a number above it. Nothing here is a judgement
 * the data does not carry.
 */
function summary(picture: DistributionPicture, rival: Rival, details: readonly AdDetail[]): string {
  const advertiser = picture.advertisers.find((entry) => entry.rivalId === rival.rivalId);
  const ads = advertiser ? picture.ads.filter((ad) => ad.advertiserId === advertiser.advertiserId) : [];
  const readings = advertiser
    ? byAdvertiser(picture.marketSweep ?? []).get(advertiser.advertiserId) ?? []
    : [];
  const swept = summariseSweep(readings);
  const withReach = details.filter((detail) => detail.euTotalReach !== null);

  const lines: string[] = [];
  lines.push(
    rival.isFree
      ? `Free to install, ${rival.ratingCount > 0 ? `${number(rival.ratingCount)} ratings` : "no published rating count"}.`
      : `Charges ${escapeHtml(rival.formattedPrice)} up front, ${rival.ratingCount > 0 ? `${number(rival.ratingCount)} ratings` : "no published rating count"}.`,
  );
  if (!advertiser) {
    lines.push("No advertiser account was matched, so nothing below the store is known about them.");
  } else if (swept.marketsWithAds === 0) {
    lines.push(`Runs nothing today in any of the ${swept.marketsRead} markets read.`);
  } else {
    lines.push(
      `Buying in ${swept.marketsWithAds} of ${swept.marketsRead} markets, hardest in ${escapeHtml(swept.busiest?.market ?? "")} at ${swept.busiest?.liveAds ?? 0} advertisements.`,
    );
    const pressure = swept.busiest ? pressurePer10k(swept.busiest) : null;
    if (pressure !== null) {
      lines.push(
        `That is ${pressure.toFixed(1)} advertisements for every 10,000 lifetime ratings in that market.`,
      );
    }
  }
  if (ads.length > 0) {
    const live = ads.filter((ad) => ad.active).length;
    const longest = Math.max(...ads.map((ad) => ad.daysLive ?? 0), 0);
    lines.push(
      `${ads.length} advertisements captured, ${live} still running, longest run ${longest} days.`,
    );
  }
  if (withReach.length > 0) {
    const total = withReach.reduce((sum, detail) => sum + (detail.euTotalReach ?? 0), 0);
    const gender = withReach
      .map(reachByGender)
      .reduce((sum, split) => ({ male: sum.male + split.male, total: sum.total + split.total }), {
        male: 0,
        total: 0,
      });
    lines.push(
      `Across ${withReach.length} advertisements read in detail, ${number(total)} people reached in the European Union, ${percent(gender.male / (gender.total || 1))} of them men.`,
    );
  }

  return `<section>
    <h2>In short</h2>
    <ul class="gaps">${lines.map((sentence) => `<li>${sentence}</li>`).join("")}</ul>
  </section>`;
}

const RIVAL_STYLES = `
.detail-card { background: var(--surface-sunk); border: 1px solid var(--line); border-radius: 4px; padding: 20px; margin-top: 16px; }
.detail-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.detail-reach { font-family: var(--mono); font-size: 26px; font-variant-numeric: tabular-nums; color: var(--accent); }
.detail-reach-label { font-size: 13px; color: var(--text-soft); }
.crumb { font-family: var(--mono); font-size: 12.5px; margin-bottom: 8px; display: block; }
`;

export function buildRivalPage(picture: DistributionPicture, rival: Rival): string {
  const advertiser = picture.advertisers.find((entry) => entry.rivalId === rival.rivalId);
  const details = (picture.adDetails ?? []).filter((detail) =>
    advertiser
      ? picture.ads.some(
          (ad) => ad.libraryId === detail.libraryId && ad.advertiserId === advertiser.advertiserId,
        )
      : false,
  );

  return `<title>${escapeHtml(rival.name)} &middot; Proofmark</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLES}${RIVAL_STYLES}</style>
<div class="wrap">
  <header>
    <a class="crumb" href="../">&larr; ${escapeHtml(picture.product.name)} rival watch</a>
    <div class="eyebrow">Competitor</div>
    <h1>${escapeHtml(rival.name)}</h1>
    <p class="subtitle">${escapeHtml(rival.seller || "publisher not published")}</p>
    <p class="provenance">Read ${escapeHtml(picture.readAt.slice(0, 10))} &middot; ${escapeHtml(picture.product.market.toUpperCase())} store &middot; ${
      advertiser ? `${escapeHtml(advertiser.matchConfidence)} match on Meta` : "no advertiser account matched"
    }</p>
  </header>

  ${summary(picture, rival, details)}
  ${identity(picture, rival, details)}
  ${channels(picture, rival)}
  ${marketsFor(picture, rival)}
  ${campaigns(picture, rival)}
  ${audience(details)}
</div>`;
}
