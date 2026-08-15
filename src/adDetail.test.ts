import { readFileSync } from "node:fs";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import {
  deliveredTotal,
  parseAdDetail,
  reachByAge,
  reachByCountry,
  reachByGender,
  targetedVersusDelivered,
  breakdownGap,
} from "./adDetail.ts";

/**
 * A real response, trimmed to three countries. Copied from the library on
 * 2026-08-15 for ShutEye advertisement 1583617746100371, not hand written, so
 * the parser is held to the shape the platform actually sends.
 */
const REAL = readFileSync(new URL("./fixtures/ad-detail-shuteye.json", import.meta.url), "utf8");

test("the audience numbers are read out of a real response", () => {
  const detail = parseAdDetail(REAL, "1583617746100371");
  ok(detail, "the fixture must parse");
  strictEqual(detail.euTotalReach, 166154);
  strictEqual(detail.targetedAgeMin, 18);
  strictEqual(detail.targetedAgeMax, 65);
  strictEqual(detail.targetedGender, "All");
  strictEqual(detail.deliveredReach.length, 3);
});

test("who paid and who benefits are both read, because they differ", () => {
  const detail = parseAdDetail(REAL, "1583617746100371");
  ok(detail);
  // The advertisement is paid for by two entities and benefits a third company
  // in Beijing. A report naming only the advertiser would miss that entirely.
  deepStrictEqual(detail.payers, ["ShutEye - Sleep Tracker, Recorder", "Pingme Limited"]);
  strictEqual(detail.beneficiaries.length, 1);
  ok(detail.beneficiaries[0]?.length ?? 0 > 0);
});

test("the buyer asked for everyone and the platform delivered men in middle age", () => {
  const detail = parseAdDetail(REAL, "1583617746100371");
  ok(detail);
  const gender = reachByGender(detail);
  ok(gender.male > gender.female, "delivery skews male against an All target");
  const ages = reachByAge(detail);
  const middle = ages
    .filter((band) => ["35-44", "45-54", "55-64"].includes(band.ageRange))
    .reduce((sum, band) => sum + band.share, 0);
  ok(middle > 0.7, `expected middle age to carry the reach, got ${(middle * 100).toFixed(1)}%`);
  const young = ages.find((band) => band.ageRange === "18-24");
  ok((young?.share ?? 0) < 0.05, "under 25 is a rounding error despite being targeted");
});

test("age bands come back in age order, not in the order the platform sent them", () => {
  const detail = parseAdDetail(REAL, "1583617746100371");
  ok(detail);
  deepStrictEqual(
    reachByAge(detail).map((band) => band.ageRange),
    ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"],
  );
});

test("the published cells do not add up to the published headline, and the gap is reported", () => {
  const detail = parseAdDetail(REAL, "1583617746100371");
  ok(detail);
  const counted = deliveredTotal(detail);
  ok(counted > 0);
  // Only three of thirty countries are in the fixture, so the shortfall here is
  // large. What matters is that the two numbers are kept apart rather than one
  // being made to equal the other.
  const share = breakdownGap(detail);
  ok(share !== null && share > 0, "a gap must be visible, never reconciled away");
  strictEqual(targetedVersusDelivered(detail).headlineReach, 166154);
  strictEqual(targetedVersusDelivered(detail).countedReach, counted);
});

test("countries come back ranked by the people actually reached", () => {
  const detail = parseAdDetail(REAL, "1583617746100371");
  ok(detail);
  const ranked = reachByCountry(detail);
  strictEqual(ranked.length, 3);
  ok((ranked[0]?.people ?? 0) >= (ranked[1]?.people ?? 0));
  ok((ranked[1]?.people ?? 0) >= (ranked[2]?.people ?? 0));
});

test("an advertisement outside the European Union has no reach, and that is not zero", () => {
  const outside = JSON.stringify({
    data: { ad_library_main: { ad_details: { aaa_info: { payer_beneficiary_data: [] } } } },
  });
  const detail = parseAdDetail(outside, "1");
  ok(detail, "a card with no transparency block still parses");
  strictEqual(detail.euTotalReach, null);
  strictEqual(detail.targetedAgeMin, null);
  strictEqual(detail.targetedGender, null);
  deepStrictEqual(detail.deliveredReach, []);
  strictEqual(breakdownGap(detail), null, "no headline means no gap to state");
  strictEqual(deliveredTotal(detail), 0);
});

test("a withheld cell counts as zero people, never as a missing row", () => {
  const withNulls = JSON.stringify({
    data: {
      ad_library_main: {
        ad_details: {
          transparency_by_location: {
            eu_transparency: {
              eu_total_reach: 100,
              age_country_gender_reach_breakdown: [
                { country: "IE", age_gender_breakdowns: [{ age_range: "25-34", male: 5, female: null, unknown: null }] },
              ],
            },
          },
        },
      },
    },
  });
  const detail = parseAdDetail(withNulls, "1");
  ok(detail);
  strictEqual(deliveredTotal(detail), 5);
  strictEqual(reachByGender(detail).female, 0);
  strictEqual(reachByAge(detail).length, 1);
});

test("a body that is not a response at all returns nothing rather than an empty picture", () => {
  strictEqual(parseAdDetail("not json", "1"), null);
  strictEqual(parseAdDetail(JSON.stringify({ errors: [{ message: "Rate limit exceeded" }] }), "1"), null);
});

test("the gap runs both ways, so it is a difference and never a shortfall", () => {
  // Read live on 2026-08-15: three ShutEye advertisements gave +1.6, -2.8 and
  // -2.2 per cent. The headline counts a person once and the breakdown counts
  // them per country and band, so neither number contains the other.
  const overCounting = JSON.stringify({
    data: {
      ad_library_main: {
        ad_details: {
          transparency_by_location: {
            eu_transparency: {
              eu_total_reach: 100,
              age_country_gender_reach_breakdown: [
                { country: "SE", age_gender_breakdowns: [{ age_range: "45-54", male: 60, female: 40, unknown: 0 }] },
                { country: "NL", age_gender_breakdowns: [{ age_range: "45-54", male: 20, female: 10, unknown: 0 }] },
              ],
            },
          },
        },
      },
    },
  });
  const detail = parseAdDetail(overCounting, "1");
  ok(detail);
  strictEqual(deliveredTotal(detail), 130);
  const gap = breakdownGap(detail);
  ok(gap !== null && gap < 0, `the cells may exceed the headline, got ${gap}`);
});

test("an age band the library will not name sorts last, not first", () => {
  const withUnknown = JSON.stringify({
    data: {
      ad_library_main: {
        ad_details: {
          transparency_by_location: {
            eu_transparency: {
              eu_total_reach: 10,
              age_country_gender_reach_breakdown: [
                {
                  country: "SE",
                  age_gender_breakdowns: [
                    { age_range: "Unknown", male: 1, female: 0, unknown: 0 },
                    { age_range: "65+", male: 2, female: 0, unknown: 0 },
                    { age_range: "18-24", male: 3, female: 0, unknown: 0 },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  });
  const detail = parseAdDetail(withUnknown, "1");
  ok(detail);
  deepStrictEqual(reachByAge(detail).map((band) => band.ageRange), ["18-24", "65+", "Unknown"]);
});
