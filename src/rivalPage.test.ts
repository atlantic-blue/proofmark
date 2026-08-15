import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRivalPage } from "./rivalPage.ts";
import { parseAdDetail } from "./adDetail.ts";
import type { AdDetail, DistributionPicture, Rival } from "./types.ts";

const DETAIL = parseAdDetail(
  readFileSync(new URL("./fixtures/ad-detail-shuteye.json", import.meta.url), "utf8"),
  "1583617746100371",
) as AdDetail;

const RIVAL: Rival = {
  rivalId: "shuteye",
  name: "ShutEye: Sleep Tracker, Sounds",
  appleAppId: "1490078804",
  seller: "ENERJOY PTE. LTD.",
  domain: "https://shuteye.ai",
  formattedPrice: "Free",
  isFree: true,
  ratingCount: 33470,
  averageRating: 4.68,
  releaseDate: "2019-11-01",
  lastUpdated: "2026-08-01",
  foundVia: [{ term: "snoring", position: 3 }],
};

const PICTURE: DistributionPicture = {
  product: { productId: "hush-log", name: "Hush Log", job: "records snoring", market: "gb", storeEntity: "software", searchTerms: ["snoring"], brandTerms: ["hush log"] },
  readAt: "2026-08-15T00:00:00.000Z",
  rivals: [RIVAL],
  advertisers: [
    { platform: "meta", advertiserId: "105561090976700", rivalId: "shuteye", name: "ShutEye - Sleep Tracker, Recorder", matchConfidence: "probable", activeAdCountAtLeast: 10 },
  ],
  ads: [
    { platform: "meta", libraryId: "1583617746100371", libraryUrl: "https://www.facebook.com/ads/library/?id=1583617746100371", format: "video", mediaUrls: [], advertiserId: "105561090976700", advertiser: "ShutEye - Sleep Tracker, Recorder", startedRunning: "22 Dec 2025", ended: null, daysLive: 236, active: true, creativeShareCount: 7, bodyFirstLine: "Better sleep starts here", bodyChars: 24, body: "Better sleep starts here" },
    { platform: "meta", libraryId: "999", libraryUrl: "https://www.facebook.com/ads/library/?id=999", format: "video", mediaUrls: [], advertiserId: "105561090976700", advertiser: "ShutEye - Sleep Tracker, Recorder", startedRunning: "1 Jan 2026", ended: "10 Jan 2026", daysLive: 10, active: false, creativeShareCount: 1, bodyFirstLine: "", bodyChars: 0, body: "" },
  ],
  hooks: [
    { platform: "meta", advertiser: "ShutEye - Sleep Tracker, Recorder", copy: "Better sleep starts here", formats: ["video"], exampleUrl: "https://www.facebook.com/ads/library/?id=1583617746100371", exampleMedia: [], runLengths: [236], creatives: 7, runs: 1, longestRunDays: 236, firstSeen: "2025-12-22", lastSeen: null, stillRunning: true },
  ],
  presence: [{ rivalId: "shuteye", url: "https://shuteye.ai", httpStatus: 200, advertisingPlatforms: ["Meta"], attributionProviders: ["AppsFlyer"], analytics: [], tagContainers: [] }],
  voice: [],
  categoryAdvertisers: [],
  marketSweep: [
    { market: "SE", advertiserId: "105561090976700", liveAds: 20, ratings: 2333, formattedPrice: "Free" },
    { market: "GB", advertiserId: "105561090976700", liveAds: 12, ratings: 33470, formattedPrice: "Free" },
    { market: "US", advertiserId: "105561090976700", liveAds: 70, ratings: 349104, formattedPrice: "Free" },
  ],
  adDetails: [DETAIL],
  gaps: [],
};

test("the page answers who they are, with somewhere to go and look", () => {
  const page = buildRivalPage(PICTURE, RIVAL);
  assert.match(page, /<title>ShutEye: Sleep Tracker, Sounds/);
  assert.match(page, /apps\.apple\.com\/gb\/app\/id1490078804/);
  assert.match(page, /https:\/\/shuteye\.ai/);
  assert.match(page, /view_all_page_id=105561090976700/);
  assert.match(page, /ENERJOY PTE\. LTD\./);
  assert.match(page, /33,470 at 4\.68/);
});

test("who pays and who benefits are shown, because they are not the same company", () => {
  const page = buildRivalPage(PICTURE, RIVAL);
  assert.match(page, /Pays for the advertising/);
  assert.match(page, /Pingme Limited/);
  assert.match(page, /Advertising benefits/);
});

test("the audience shows what was asked for beside what was delivered", () => {
  const page = buildRivalPage(PICTURE, RIVAL);
  assert.match(page, /166,154/);
  assert.match(page, /Asked for 18 to 65, All, 4 countries/);
  assert.match(page, /Delivered to \d+\.\d% men/);
  assert.match(page, /Delivered by age/);
  assert.match(page, /Delivered by country/);
});

test("the page says the headline and the cells are measured differently", () => {
  const page = buildRivalPage(PICTURE, RIVAL);
  assert.match(page, /neither number contains the other/);
  assert.ok(!page.includes("withheld"), "the gap must not be described as withholding");
});

test("a rival with no European campaign says so rather than showing nothing", () => {
  const page = buildRivalPage({ ...PICTURE, adDetails: [] }, RIVAL);
  assert.ok(!page.includes("166,154"));
  assert.ok(!page.includes("Who it reached"), "no detail read means no audience section at all");
});

test("an advertisement served outside the Union reports no reach, not zero reach", () => {
  const outside: AdDetail = { ...DETAIL, euTotalReach: null, deliveredReach: [] };
  const page = buildRivalPage({ ...PICTURE, adDetails: [outside] }, RIVAL);
  assert.match(page, /no reach, age or gender is published for them anywhere/);
});

test("the campaigns section separates running from ended and counts re-use", () => {
  const page = buildRivalPage(PICTURE, RIVAL);
  assert.match(page, />1<\/div><div class="stat-label">running today/);
  assert.match(page, />1<\/div><div class="stat-label">already ended/);
  assert.match(page, />1<\/div><div class="stat-label">creatives used more than once/);
  assert.match(page, />236d<\/div><div class="stat-label">longest run/);
});

test("only this rival's advertisements reach this rival's page", () => {
  const withOther: DistributionPicture = {
    ...PICTURE,
    ads: [
      ...PICTURE.ads,
      { platform: "meta", libraryId: "555", libraryUrl: "u", format: "video", mediaUrls: [], advertiserId: "OTHER", advertiser: "SnoreLab", startedRunning: "1 Jan 2026", ended: null, daysLive: 5, active: true, creativeShareCount: 1, bodyFirstLine: "someone else", bodyChars: 12, body: "someone else" },
    ],
  };
  const page = buildRivalPage(withOther, RIVAL);
  assert.ok(!page.includes("someone else"), "another advertiser's copy must never appear here");
  assert.match(page, />1<\/div><div class="stat-label">running today/);
});

test("the markets section counts only this rival, and names what a count is not", () => {
  const page = buildRivalPage(PICTURE, RIVAL);
  assert.match(page, /Live in 3 of 3 markets read/);
  assert.match(page, /counts objects, never budget/);
});

test("the page names the platforms that were never read", () => {
  const page = buildRivalPage(PICTURE, RIVAL);
  assert.match(page, /Only Meta is read today/);
  assert.match(page, /Apple Search Ads publishes no library/);
});

test("markup in a rival's own fields is escaped, never rendered", () => {
  const nasty: Rival = { ...RIVAL, seller: '<script>alert("x")</script>' };
  const page = buildRivalPage({ ...PICTURE, rivals: [nasty] }, nasty);
  assert.ok(!page.includes("<script>alert"));
  assert.match(page, /&lt;script&gt;alert/);
});
