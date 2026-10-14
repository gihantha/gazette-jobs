/**
 * Polite HTTP helper for the scrapers.
 *
 * These are small volunteer-run gazette aggregators, so we keep the footprint
 * low: one request at a time, a real User-Agent with a contact URL, a delay
 * between requests, bounded retries on transient failures, and a hard timeout
 * so a hanging source can never stall the whole cron run.
 */

const USER_AGENT =
  "GazetteJobsBot/1.0 (+https://github.com/; personal job-deadline tracker; contact via repo issues)";

/** Milliseconds to wait between consecutive requests to the same host. */
const POLITE_DELAY_MS = 700;

/** Per-request timeout. Vercel's default function budget is 10s on hobby. */
const TIMEOUT_MS = 15_000;

const MAX_ATTEMPTS = 3;

const lastRequestAt = new Map<string, number>();

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch a URL as text, with throttling, retries and a timeout. */
export async function fetchText(url: string): Promise<string> {
  const host = new URL(url).host;

  // Throttle per host rather than globally so two sources can interleave.
  const since = Date.now() - (lastRequestAt.get(host) ?? 0);
  if (since < POLITE_DELAY_MS) await sleep(POLITE_DELAY_MS - since);
  lastRequestAt.set(host, Date.now());

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        // Always hit the network; the cron job is the only caller and it wants
        // fresh data. Next.js would otherwise cache this fetch.
        cache: "no-store",
      });

      if (!res.ok) {
        // 4xx (other than 429) will not fix themselves — fail fast.
        if (res.status !== 429 && res.status < 500) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        throw new Error(`HTTP ${res.status} (retryable)`);
      }

      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        // Exponential backoff: 1s, 2s.
        await sleep(1000 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `fetch failed for ${url} after ${MAX_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Share of characters that are plain ASCII.
 *
 * Both sources render each title twice, once in English and once in Sinhala —
 * and both mislabel which is which (govdoc puts the English title inside
 * `.title-sin`). The Sinhala is also served in a legacy font encoding, so it
 * arrives as mojibake rather than real Sinhala codepoints. Picking the more
 * ASCII-heavy of the two strings is what reliably finds the English one.
 */
export function asciiRatio(text: string): number {
  if (!text.length) return 0;
  let ascii = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code <= 126) ascii++;
  }
  return ascii / [...text].length;
}
