/**
 * Reads a rival's own website and reports which advertising platforms they have
 * measurement built for, and which mobile attribution provider they use.
 *
 * A conversion pixel is not proof of spend. It is proof that somebody built the
 * measurement, which nobody does for a platform they never buy on.
 *
 * The limits are real and the report states them. A site pixel says where a
 * company measures WEB conversions. An application install campaign needs no web
 * pixel at all, which is why SnoreLab runs Meta advertisements while carrying no
 * Meta pixel. And Apple Search Ads leaves no public trace anywhere.
 *
 * Google Tag Manager containers are public, so when one is present its source is
 * fetched and scanned too. Many sites carry no tag in their own markup and every
 * tag inside the container.
 */

import type { PlatformPresence } from "./types.ts";

interface Signature {
  readonly platform: string;
  readonly kind: "ads" | "analytics" | "attribution";
  readonly patterns: readonly RegExp[];
}

const SIGNATURES: readonly Signature[] = [
  { platform: "Meta", kind: "ads", patterns: [/connect\.facebook\.net/i, /facebook\.com\/tr/i, /\bfbq\s*\(/i] },
  { platform: "Google Ads", kind: "ads", patterns: [/gtag\/js\?id=AW-/i, /googleads\.g\.doubleclick\.net/i, /google_conversion/i, /"AW-\d/] },
  { platform: "TikTok", kind: "ads", patterns: [/analytics\.tiktok\.com/i, /\bttq\.(load|page|track)/i] },
  { platform: "LinkedIn", kind: "ads", patterns: [/snap\.licdn\.com/i, /_linkedin_partner_id/i] },
  { platform: "X", kind: "ads", patterns: [/static\.ads-twitter\.com/i, /\btwq\s*\(/i] },
  { platform: "Microsoft Ads", kind: "ads", patterns: [/bat\.bing\.com/i, /uetq/i] },
  { platform: "Reddit", kind: "ads", patterns: [/redditstatic\.com\/ads/i, /\brdt\s*\(/i] },
  { platform: "Pinterest", kind: "ads", patterns: [/\bpintrk\s*\(/i, /s\.pinimg\.com\/ct/i] },
  { platform: "Snapchat", kind: "ads", patterns: [/sc-static\.net\/scevent/i, /\bsnaptr\s*\(/i] },
  { platform: "Google Analytics", kind: "analytics", patterns: [/gtag\/js\?id=G-/i, /google-analytics\.com/i] },
  { platform: "Hotjar or Clarity", kind: "analytics", patterns: [/static\.hotjar\.com/i, /clarity\.ms/i] },
  { platform: "AppsFlyer", kind: "attribution", patterns: [/appsflyer/i, /onelink\.me/i] },
  { platform: "Adjust", kind: "attribution", patterns: [/app\.adjust\.com/i, /adjust\.io/i] },
  { platform: "Branch", kind: "attribution", patterns: [/branch\.io/i, /app\.link/i] },
  { platform: "Kochava", kind: "attribution", patterns: [/kochava/i, /smart\.link/i] },
  { platform: "Singular", kind: "attribution", patterns: [/singular\.net/i, /sng\.link/i] },
  { platform: "Apple Search Ads", kind: "attribution", patterns: [/AppleAdsAttribution/i, /iad-attribution/i] },
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TIMEOUT_MS = 20_000;

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    return { status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

export function findContainerIds(source: string): string[] {
  return [...new Set([...source.matchAll(/GTM-[A-Z0-9]{4,10}/g)].map((match) => match[0]))];
}

export function scan(source: string): { platform: string; kind: string }[] {
  const hits: { platform: string; kind: string }[] = [];
  for (const signature of SIGNATURES) {
    if (signature.patterns.some((pattern) => pattern.test(source))) {
      hits.push({ platform: signature.platform, kind: signature.kind });
    }
  }
  return hits;
}

export async function readPresence(rivalId: string, url: string): Promise<PlatformPresence> {
  try {
    const page = await fetchText(url);
    let combined = page.body;
    const containers = findContainerIds(page.body);
    for (const containerId of containers) {
      try {
        const container = await fetchText(`https://www.googletagmanager.com/gtm.js?id=${containerId}`);
        if (container.status === 200) combined += container.body;
      } catch {
        // A container that will not load is a gap, not a finding.
      }
    }
    const hits = scan(combined);
    return {
      rivalId,
      url,
      httpStatus: page.status,
      advertisingPlatforms: hits.filter((hit) => hit.kind === "ads").map((hit) => hit.platform),
      attributionProviders: hits.filter((hit) => hit.kind === "attribution").map((hit) => hit.platform),
      analytics: hits.filter((hit) => hit.kind === "analytics").map((hit) => hit.platform),
      tagContainers: containers,
    };
  } catch {
    return {
      rivalId,
      url,
      httpStatus: 0,
      advertisingPlatforms: [],
      attributionProviders: [],
      analytics: [],
      tagContainers: [],
    };
  }
}
