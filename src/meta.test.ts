import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brandOf,
  firstRealLine,
  daysBetween,
  keywordSearchUrl,
  matchAdvertiser,
  parseAdvertiserCensus,
  parseAds,
  parseLibraryDate,
  rankHooks,
} from "./meta.ts";

/** Copied from a real dump taken on 2026-08-14, not written by hand. */
const ADVERTISER_VIEW = `~150 results
Inactive
Library ID: 1893577217926189
30 Dec 2025 - 8 Jan 2026
Platforms
7 ads use this creative and text
See summary details
SnoreLab
Sponsored
Have you been told you snore? SnoreLab records and measures your snoring.
Active
Library ID: 1573380140661000
1 Aug 2026 - 14 Aug 2026
Platforms
3 ads use this creative and text
See summary details
SnoreLab
Sponsored
Discover your BreathFlow, SnoreLab's unique measure of breathing stability.
`;

const KEYWORD_VIEW = `~14 results
Active
Library ID: 28051154691168823
Started running on 29 Jul 2026
Platforms
See ad details
UK Sleep Apnoea Forum
Sponsored
My Snorelab Score Was 214. I Couldn't Recognise Myself On The Recording.
`;

const CAPTURES = [
  {
    body: JSON.stringify({
      data: {
        ad_library_main: {
          dynamic_filter_options: {
            pages: [
              { count: 10, key: "149967288461419", display_name: "SnoreLab" },
              { count: 1, key: "114938178182149", display_name: "Sleep Apnea Journal" },
              { count: 4, key: "999", display_name: "SnoreLab UK" },
            ],
          },
        },
      },
    }),
  },
];

const READ_AT = new Date("2026-08-14T00:00:00Z");

test("reads a finished run and counts its days inclusively", () => {
  const ads = parseAds(ADVERTISER_VIEW, READ_AT);
  assert.equal(ads.length, 2);
  assert.equal(ads[0]?.libraryId, "1893577217926189");
  assert.equal(ads[0]?.daysLive, 10);
  assert.equal(ads[0]?.active, false);
  assert.equal(ads[0]?.creativeShareCount, 7);
  assert.equal(ads[0]?.advertiser, "SnoreLab");
});

test("measures a live run to the day of reading", () => {
  const ads = parseAds(ADVERTISER_VIEW, READ_AT);
  assert.equal(ads[1]?.active, true);
  assert.equal(ads[1]?.daysLive, 14);
});

test("reads the keyword view, which gives a start and no end", () => {
  const ads = parseAds(KEYWORD_VIEW, READ_AT);
  assert.equal(ads.length, 1);
  assert.equal(ads[0]?.ended, null);
  assert.equal(ads[0]?.daysLive, 17);
  assert.equal(ads[0]?.creativeShareCount, 1);
});

test("a run of one day counts as one day, never zero", () => {
  const day = new Date("2026-08-14T00:00:00Z");
  assert.equal(daysBetween(day, day), 1);
});

test("rejects a date shape the library does not use rather than guessing", () => {
  assert.equal(parseLibraryDate("2026-08-14"), null);
  assert.equal(parseLibraryDate("30 Foo 2025"), null);
  assert.equal(parseLibraryDate("8 Jan 2026")?.toISOString().slice(0, 10), "2026-01-08");
});

test("reads the advertiser census and orders it by count", () => {
  const census = parseAdvertiserCensus(CAPTURES);
  assert.equal(census.length, 3);
  assert.equal(census[0]?.name, "SnoreLab");
  assert.equal(census[0]?.count, 10);
});

test("an exact name is a confirmed match", () => {
  const match = matchAdvertiser("SnoreLab", parseAdvertiserCensus(CAPTURES));
  assert.equal(match?.advertiserId, "149967288461419");
  assert.equal(match?.confidence, "confirmed");
});

test("a name that only starts the same is probable, never confirmed", () => {
  const census = parseAdvertiserCensus(CAPTURES).filter((entry) => entry.name !== "SnoreLab");
  const match = matchAdvertiser("SnoreLab", census);
  assert.equal(match?.name, "SnoreLab UK");
  assert.equal(match?.confidence, "probable");
});

test("an unrelated advertiser is not matched at all", () => {
  assert.equal(matchAdvertiser("Pillow", parseAdvertiserCensus(CAPTURES)), null);
});

test("a rival name too short to be distinctive is refused", () => {
  assert.equal(matchAdvertiser("Ab", parseAdvertiserCensus(CAPTURES)), null);
});

test("ranks hooks by creatives behind the copy, not by length of run", () => {
  const ads = [
    ...parseAds(ADVERTISER_VIEW, READ_AT),
    ...parseAds(
      `Inactive
Library ID: 5
1 Jan 2026 - 30 Jun 2026
Platforms
1 ads use this creative and text
See summary details
SnoreLab
Sponsored
A long running advertisement nobody scaled.
`,
      READ_AT,
    ),
  ];
  const hooks = rankHooks(ads);
  assert.equal(hooks[0]?.creatives, 7);
  assert.match(hooks[0]?.copy ?? "", /Have you been told you snore/);

  const longRun = hooks.find((hook) => hook.copy.startsWith("A long running"));
  assert.equal(longRun?.longestRunDays, 181);
  assert.ok(
    (hooks[0]?.longestRunDays ?? 0) < (longRun?.longestRunDays ?? 0),
    "the top hook must win on creatives even though its run is much shorter",
  );
});

test("a hook groups every run that repeats the same copy", () => {
  const twice = ADVERTISER_VIEW + ADVERTISER_VIEW.replace("1893577217926189", "1893577217926190");
  const hooks = rankHooks(parseAds(twice, READ_AT));
  const top = hooks[0];
  assert.equal(top?.runs, 2);
  assert.equal(top?.creatives, 14);
});

test("a dump with nothing in it yields nothing rather than throwing", () => {
  assert.deepEqual(parseAds("No results found", READ_AT), []);
  assert.deepEqual(parseAdvertiserCensus([]), []);
  assert.deepEqual(rankHooks([]), []);
});


test("the brand is taken out of a store title, because the account uses the brand", () => {
  assert.equal(brandOf("SnoreLab : Record Your Snoring"), "SnoreLab");
  assert.equal(brandOf("ShutEye: Sleep Tracker, Sounds"), "ShutEye");
  assert.equal(brandOf("SleepWatch - Top Sleep Tracker"), "SleepWatch");
  assert.equal(brandOf("Sleep Cycle - Tracker & Sounds"), "Sleep Cycle");
  assert.equal(brandOf("Pillow (Sleep Tracker)"), "Pillow");
  assert.equal(brandOf("CleanMyMac"), "CleanMyMac");
});

test("a tier word is dropped, because the shorter brand matches more accounts", () => {
  // "Cleaner One" finds the account whether it is called "Cleaner One" or
  // "Cleaner One Pro", and containment covers the longer form. Keeping "Pro"
  // would miss an account named after the plain brand.
  assert.equal(brandOf("Cleaner One Pro - Uninstaller"), "Cleaner One");
  assert.equal(brandOf("BestSleep App"), "BestSleep");
  assert.equal(brandOf("Something Lite"), "Something");
});

test("a rival is matched by its brand when the store title is longer", () => {
  const census = parseAdvertiserCensus(CAPTURES);
  const match = matchAdvertiser("SnoreLab : Record Your Snoring", census);
  assert.equal(match?.advertiserId, "149967288461419");
  assert.equal(match?.confidence, "confirmed");
});

test("the search can include advertisements that have ended, or a paused rival looks absent", () => {
  assert.match(keywordSearchUrl("snoring", "gb"), /active_status=active/);
  assert.match(
    keywordSearchUrl("snoring", "gb", { activeOnly: false }),
    /active_status=all/,
  );
  assert.match(keywordSearchUrl("stop snoring", "gb"), /q=stop%20snoring/);
  assert.match(keywordSearchUrl("snoring", "gb"), /country=GB/);
});

test("the query is lower cased, because the library search is case sensitive", () => {
  // "snorelab" returns SnoreLab with ten advertisements; "SnoreLab" returns a
  // different set that does not contain them, which reads as "no advertiser".
  assert.match(keywordSearchUrl("SnoreLab", "gb"), /q=snorelab/);
  assert.doesNotMatch(keywordSearchUrl("SnoreLab", "gb"), /q=SnoreLab/);
  assert.match(keywordSearchUrl("CleanMyMac", "gb"), /q=cleanmymac/);
});


test("a video player readout is never taken for the advertisement copy", () => {
  assert.equal(firstRealLine(["0:00 / 0:37", "Sleep better tonight"]), "Sleep better tonight");
  assert.equal(firstRealLine(["", "  ", "12:05", "Real copy here"]), "Real copy here");
  assert.equal(firstRealLine(["0:00 / 0:37"]), "");
  assert.equal(firstRealLine(["Have you been told you snore?"]), "Have you been told you snore?");
});
