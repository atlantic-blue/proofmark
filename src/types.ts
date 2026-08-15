/**
 * The entities the pipeline works with.
 *
 * The store is keyed by entity rather than by product, because two products
 * often share a rival and two rivals sometimes share a parent company. A
 * product declares which rivals it cares about; it does not own them.
 *
 * These names are provisional until phase 0 locks a field dictionary against a
 * real dump from every library. Today only the Meta shape is read from real
 * records.
 */

export type Platform = "meta" | "google" | "linkedin" | "tiktok" | "microsoft" | "reddit" | "x" | "pinterest" | "snapchat";

/** The input. One file per product, in `products/`. */
export interface Product {
  readonly productId: string;
  readonly name: string;
  /** The job it does, in one line. Used in the report, never in a search. */
  readonly job: string;
  readonly appleAppId?: string;
  /** Two letter store and library market, lower case. The market read in depth. */
  readonly market: string;
  /**
   * Every market the closest rival is counted in, so the report can answer where
   * their market is rather than only what they do in ours. Defaults to
   * WORLD_MARKETS. One market is a setting, and picking the wrong one is how a
   * rival's quietest country got read as the whole category.
   */
  readonly worldMarkets?: readonly string[];
  /** What Apple calls the thing: "software" for iPhone, "macSoftware" for Mac. */
  readonly storeEntity: string;
  /** What a buyer would type. Drives rival discovery. */
  readonly searchTerms: readonly string[];
  /** Words that identify us, so we are never listed as our own rival. */
  readonly brandTerms: readonly string[];
}

export interface Rival {
  readonly rivalId: string;
  readonly name: string;
  readonly appleAppId: string;
  readonly seller: string;
  readonly domain: string | null;
  readonly formattedPrice: string;
  readonly isFree: boolean;
  readonly ratingCount: number;
  readonly averageRating: number;
  readonly releaseDate: string;
  readonly lastUpdated: string;
  /** Which of the product's search terms surfaced it, and at what position. */
  readonly foundVia: readonly { term: string; position: number }[];
}

/** A rival's identity on one advertising platform. */
export interface Advertiser {
  readonly platform: Platform;
  readonly advertiserId: string;
  readonly rivalId: string;
  readonly name: string;
  readonly matchConfidence: "confirmed" | "probable";
  readonly activeAdCountAtLeast: number;
}

export type AdFormat = "video" | "image" | "text or unknown";

export interface Ad {
  readonly platform: Platform;
  readonly libraryId: string;
  /** The library's permanent page for this advertisement. Always constructible. */
  readonly libraryUrl: string;
  readonly format: AdFormat;
  /** Creative files served with the card. Expire, so they are a snapshot not an archive. */
  readonly mediaUrls: readonly string[];
  readonly advertiserId: string | null;
  readonly advertiser: string | null;
  readonly startedRunning: string | null;
  readonly ended: string | null;
  readonly daysLive: number | null;
  readonly active: boolean;
  /** How many advertisements share this copy. The scale signal. */
  readonly creativeShareCount: number;
  readonly bodyFirstLine: string;
  readonly bodyChars: number;
  readonly body: string;
}

/** One age band of one country's delivered reach. */
export interface ReachSlice {
  readonly ageRange: string;
  readonly male: number;
  readonly female: number;
  readonly unknown: number;
}

export interface CountryReach {
  readonly country: string;
  readonly slices: readonly ReachSlice[];
}

/**
 * What the library publishes about one advertisement beyond its copy.
 *
 * Every audience field here exists because of a European Union obligation, so it
 * is present for an advertisement served in the Union and absent everywhere
 * else. Great Britain has none of it. Null carries that absence and null is
 * never zero: "reached nobody" and "the rule does not apply here" are different
 * facts and a report that merges them is wrong in both directions.
 */
export interface AdDetail {
  readonly libraryId: string;
  /** People reached in the European Union. Null outside it. */
  readonly euTotalReach: number | null;
  /** What the buyer asked for. */
  readonly targetedAgeMin: number | null;
  readonly targetedAgeMax: number | null;
  readonly targetedGender: string | null;
  readonly targetedCountries: readonly string[];
  /** What the platform actually delivered. Rarely the same shape. */
  readonly deliveredReach: readonly CountryReach[];
  /** Who paid, and who the advertising is for. Not always the same company. */
  readonly payers: readonly string[];
  readonly beneficiaries: readonly string[];
}

/** What a rival's own site says they have measurement built for. */
export interface PlatformPresence {
  readonly rivalId: string;
  readonly url: string;
  readonly httpStatus: number;
  readonly advertisingPlatforms: readonly string[];
  readonly attributionProviders: readonly string[];
  readonly analytics: readonly string[];
  readonly tagContainers: readonly string[];
}

export interface Review {
  readonly appId: string;
  readonly rating: number;
  readonly title: string;
  readonly body: string;
  readonly version: string;
  readonly updated: string;
}

export interface ComplaintTheme {
  readonly name: string;
  readonly count: number;
  readonly share: number;
  readonly quotes: readonly string[];
}

export interface VoiceOfCustomer {
  readonly rivalId: string;
  readonly reviewsRead: number;
  readonly lowReviews: number;
  readonly themes: readonly ComplaintTheme[];
}

/**
 * A hook a rival has put real money behind.
 *
 * Ranked by how many creatives share the copy and how many separate runs repeat
 * it, NOT by length of run. In a seasonal application category nobody runs a 90
 * day advertisement, so length of run ranks nothing. SnoreLab put 82 creatives
 * behind one sentence in runs of 4 to 15 days.
 */
export interface ProvenHook {
  readonly platform: Platform;
  readonly advertiser: string;
  readonly copy: string;
  readonly formats: readonly string[];
  /** One advertisement from the group, so a reader can go and look at it. */
  readonly exampleUrl: string;
  readonly exampleMedia: readonly string[];
  /** Every run length in the group, so the report can show the spread. */
  readonly runLengths: readonly number[];
  readonly creatives: number;
  readonly runs: number;
  readonly longestRunDays: number | null;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly stillRunning: boolean;
}

/**
 * One rival counted in one market. Two counts, and they answer different
 * questions: how hard the rival is buying there today, and how many customers
 * they already have there.
 *
 * Both numbers are nullable and null never means zero. An unread market and an
 * empty market look identical on a page unless the type keeps them apart, and
 * "they run nothing here" is a much stronger claim than "we did not get a
 * number".
 */
export interface MarketReading {
  /** Upper case two letter country, as the library and the store write it. */
  readonly market: string;
  readonly advertiserId: string;
  /** Advertisements running today. Null when the count could not be read. */
  readonly liveAds: number | null;
  /** Lifetime ratings in that storefront, a proxy for the installed base. */
  readonly ratings: number | null;
  readonly formattedPrice: string | null;
}

/** Everything the pipeline learned about one product's competition. */
export interface DistributionPicture {
  readonly product: Product;
  readonly readAt: string;
  readonly rivals: readonly Rival[];
  readonly advertisers: readonly Advertiser[];
  readonly ads: readonly Ad[];
  readonly hooks: readonly ProvenHook[];
  readonly presence: readonly PlatformPresence[];
  readonly voice: readonly VoiceOfCustomer[];
  /** Every advertiser seen against the product's search terms, whoever they are. */
  readonly categoryAdvertisers: readonly { platform: Platform; term: string; name: string; advertiserId: string; count: number }[];
  /**
   * The closest rival counted market by market. Absent on any picture written
   * before the sweep existed, so every reader must treat it as optional.
   */
  readonly marketSweep?: readonly MarketReading[];
  /**
   * The audience behind individual advertisements. Only advertisements served in
   * the European Union have one, so this is a slice and never the whole set.
   * Absent on any picture written before the reader existed.
   */
  readonly adDetails?: readonly AdDetail[];
  readonly gaps: readonly string[];
}
