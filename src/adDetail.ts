/**
 * Reads what the library publishes about one advertisement beyond its copy.
 *
 * The card shows a label saying "EU transparency" and nothing else. The numbers
 * sit behind "See ad details", which fires `AdLibraryV3AdDetailsQuery`, and that
 * response carries the only audience data a commercial advertiser ever gives up:
 *
 *   eu_total_reach                     people reached in the European Union
 *   age_audience, gender_audience      who the buyer asked for
 *   location_audience                  which countries the buyer asked for
 *   age_country_gender_reach_breakdown who was actually reached, by country,
 *                                      age band and gender
 *   payer_beneficiary_data             who paid and who benefits
 *
 * The gap between what was asked for and what was delivered is the finding. One
 * ShutEye advertisement targeted 18 to 65 and all genders, and the platform
 * delivered 63 per cent men with 83 per cent of the reach between 35 and 64.
 *
 * Two limits, both stated in the report rather than smoothed away.
 *
 * The reach exists only for advertisements served in the European Union. This is
 * a Digital Services Act obligation, so Great Britain has none of it. Null is
 * used for that, and null is not zero.
 *
 * The breakdown does not sum to the headline. On the advertisement above the
 * cells add to 163,563 against a stated 166,154, a gap of 1.6 per cent, because
 * small cells are withheld. Both numbers are kept so a reader can see the gap
 * rather than trust a total that was quietly reconciled.
 *
 * There is no spend. `page_spend` is in the response and every field of it is
 * null with `is_political_page: false`, so the platform's own answer to "what
 * did this cost" is that it does not say.
 */

import type { AdDetail, CountryReach, ReachSlice } from "./types.ts";

/** The query the library fires when a reader opens one advertisement. */
export const AD_DETAIL_QUERY = "AdLibraryV3AdDetailsQuery";

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * A cell may be absent or null where the count was too small to publish. Those
 * become zero in the slice, because the row still exists and the person was
 * still reached; the loss shows up as the gap against the headline instead.
 */
function sliceOf(entry: unknown): ReachSlice | null {
  const record = entry as { age_range?: unknown; male?: unknown; female?: unknown; unknown?: unknown };
  const ageRange = textOf(record.age_range);
  if (!ageRange) return null;
  return {
    ageRange,
    male: numberOrNull(record.male) ?? 0,
    female: numberOrNull(record.female) ?? 0,
    unknown: numberOrNull(record.unknown) ?? 0,
  };
}

export function parseAdDetail(body: string, libraryId: string): AdDetail | null {
  // The live response arrives as one JSON document per line when the query
  // defers, so the first line is the whole answer. Any other source of the same
  // payload, a saved fixture above all, is pretty printed and its first line is
  // a single brace. Parsing the body whole comes first for that reason, and the
  // line split is the fallback rather than the rule.
  let parsed: unknown = null;
  for (const candidate of [body, body.split("\n")[0] ?? ""]) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      // The next shape gets a turn.
    }
  }
  if (parsed === null) return null;

  const details = (
    parsed as {
      data?: { ad_library_main?: { ad_details?: Record<string, unknown> } };
    }
  )?.data?.ad_library_main?.ad_details;
  if (!details) return null;

  const eu = (
    details["transparency_by_location"] as { eu_transparency?: Record<string, unknown> } | undefined
  )?.eu_transparency;

  const age = eu?.["age_audience"] as { min?: unknown; max?: unknown } | undefined;
  const locations = Array.isArray(eu?.["location_audience"]) ? (eu["location_audience"] as unknown[]) : [];
  const breakdown = Array.isArray(eu?.["age_country_gender_reach_breakdown"])
    ? (eu["age_country_gender_reach_breakdown"] as unknown[])
    : [];

  const deliveredReach: CountryReach[] = [];
  for (const entry of breakdown) {
    const record = entry as { country?: unknown; age_gender_breakdowns?: unknown };
    const country = textOf(record.country);
    if (!country) continue;
    const slices = (Array.isArray(record.age_gender_breakdowns) ? record.age_gender_breakdowns : [])
      .map(sliceOf)
      .filter((slice): slice is ReachSlice => slice !== null);
    deliveredReach.push({ country, slices });
  }

  const payerData = (
    details["aaa_info"] as { payer_beneficiary_data?: unknown } | undefined
  )?.payer_beneficiary_data;
  const pairs = Array.isArray(payerData) ? (payerData as { payer?: unknown; beneficiary?: unknown }[]) : [];

  return {
    libraryId,
    euTotalReach: numberOrNull(eu?.["eu_total_reach"]),
    targetedAgeMin: numberOrNull(age?.min),
    targetedAgeMax: numberOrNull(age?.max),
    targetedGender: textOf(eu?.["gender_audience"]),
    targetedCountries: locations
      .map((entry) => textOf((entry as { name?: unknown }).name))
      .filter((name): name is string => name !== null),
    deliveredReach,
    payers: [...new Set(pairs.map((pair) => textOf(pair.payer)).filter((name): name is string => name !== null))],
    beneficiaries: [
      ...new Set(pairs.map((pair) => textOf(pair.beneficiary)).filter((name): name is string => name !== null)),
    ],
  };
}

export function deliveredTotal(detail: AdDetail): number {
  return detail.deliveredReach.reduce(
    (sum, country) =>
      sum + country.slices.reduce((inner, slice) => inner + slice.male + slice.female + slice.unknown, 0),
    0,
  );
}

/**
 * The difference between the published headline and the published cells, as a
 * share of the headline. Positive where the cells add to less, negative where
 * they add to more.
 *
 * It goes both ways in real data. Of three ShutEye advertisements read on
 * 2026-08-15 the gaps were +1.6, -2.8 and -2.2 per cent. So the two numbers are
 * not a total and its parts: `eu_total_reach` counts people once, and the
 * breakdown counts a person in every country and age band they were reached in.
 * Neither contains the other.
 *
 * Which means this is a difference and nothing more. Do not describe it as
 * withheld data, do not reconcile it, and never add the cells up and print the
 * result as the reach.
 *
 * Null where there is no headline to compare against.
 */
export function breakdownGap(detail: AdDetail): number | null {
  if (detail.euTotalReach === null || detail.euTotalReach <= 0) return null;
  return (detail.euTotalReach - deliveredTotal(detail)) / detail.euTotalReach;
}

export interface AgeShare {
  readonly ageRange: string;
  readonly people: number;
  readonly share: number;
}

/**
 * Age bands sort by their first number, so 65+ lands after 55-64 and not before
 * 18-24. A band with no number in it is real: the library sends "Unknown", and
 * it sorts last rather than ahead of 18-24, where a zero would put it.
 */
function ageStart(ageRange: string): number {
  const first = ageRange.match(/^\d+/)?.[0];
  return first === undefined ? Number.MAX_SAFE_INTEGER : Number(first);
}

export function reachByAge(detail: AdDetail): AgeShare[] {
  const totals = new Map<string, number>();
  for (const country of detail.deliveredReach) {
    for (const slice of country.slices) {
      const people = slice.male + slice.female + slice.unknown;
      totals.set(slice.ageRange, (totals.get(slice.ageRange) ?? 0) + people);
    }
  }
  const total = [...totals.values()].reduce((sum, people) => sum + people, 0);
  return [...totals.entries()]
    .map(([ageRange, people]) => ({ ageRange, people, share: total > 0 ? people / total : 0 }))
    .sort((left, right) => ageStart(left.ageRange) - ageStart(right.ageRange));
}

export interface GenderSplit {
  readonly male: number;
  readonly female: number;
  readonly unknown: number;
  readonly total: number;
}

export function reachByGender(detail: AdDetail): GenderSplit {
  const split = { male: 0, female: 0, unknown: 0 };
  for (const country of detail.deliveredReach) {
    for (const slice of country.slices) {
      split.male += slice.male;
      split.female += slice.female;
      split.unknown += slice.unknown;
    }
  }
  return { ...split, total: split.male + split.female + split.unknown };
}

export function reachByCountry(detail: AdDetail): { country: string; people: number }[] {
  return detail.deliveredReach
    .map((country) => ({
      country: country.country,
      people: country.slices.reduce((sum, slice) => sum + slice.male + slice.female + slice.unknown, 0),
    }))
    .sort((left, right) => right.people - left.people);
}

/**
 * Countries the buyer asked for that the platform then reached almost nobody in,
 * and countries reached that were never asked for.
 *
 * Targeting is written as country names and delivery as two letter codes, so the
 * two cannot be joined without a lookup the library does not provide. Only the
 * counts are compared, and the report says which is which rather than pretending
 * they are one list.
 */
export function targetedVersusDelivered(detail: AdDetail): {
  targetedCount: number;
  deliveredCount: number;
  headlineReach: number | null;
  countedReach: number;
} {
  return {
    targetedCount: detail.targetedCountries.length,
    deliveredCount: detail.deliveredReach.length,
    headlineReach: detail.euTotalReach,
    countedReach: deliveredTotal(detail),
  };
}
