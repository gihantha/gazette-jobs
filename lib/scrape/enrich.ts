/**
 * Fill in `applyUrl` for govdoc vacancies.
 *
 * There is no database, so each job's result is kept in Vercel's built-in data
 * cache (`unstable_cache`), keyed per job. A detail page is fetched once, then
 * served from cache for days — only newly listed jobs cost a request.
 *
 * A cold cache would mean ~150 throttled requests, far past the function time
 * limit, so a single run fetches at most FETCH_BUDGET uncached pages, soonest
 * deadline first. The rest stay unknown until a later refresh picks them up.
 */
import { unstable_cache } from "next/cache";
import type { Vacancy } from "../types";
import { fetchText } from "./http";
import { extractApplyUrl } from "./applyUrl";

/** Max uncached detail pages fetched per refresh (~0.8s each). */
const FETCH_BUDGET = 20;

/** Stop early if the site looks down, rather than burning retries on every job. */
const MAX_CONSECUTIVE_FAILURES = 2;

const CACHE_SECONDS = 3 * 24 * 3600;

// Shared with the cached function below, which cannot take per-call arguments
// that are not part of its cache key.
let remainingBudget = 0;

class BudgetExhausted extends Error {}

const lookup = unstable_cache(
  async (_id: string, url: string): Promise<string | null> => {
    if (remainingBudget <= 0) throw new BudgetExhausted();
    remainingBudget--;
    // Throws on network failure, and a thrown error is not cached — so a
    // failed fetch is retried on the next refresh instead of stored as "none".
    return extractApplyUrl(await fetchText(url), url);
  },
  ["govdoc-apply-url-v1"],
  { revalidate: CACHE_SECONDS },
);

export async function enrichApplyLinks(vacancies: Vacancy[]): Promise<Vacancy[]> {
  remainingBudget = FETCH_BUDGET;
  let failures = 0;
  const found = new Map<string, string | null>();

  // `vacancies` arrives sorted soonest-deadline first, so urgent jobs get
  // their link before the budget runs out.
  for (const v of vacancies) {
    if (v.source !== "govdoc") continue;
    try {
      found.set(v.id, await lookup(v.id, v.url));
      failures = 0;
    } catch (err) {
      if (err instanceof BudgetExhausted) break;
      console.error(`[enrich] ${v.url}:`, err instanceof Error ? err.message : err);
      if (++failures >= MAX_CONSECUTIVE_FAILURES) break;
    }
  }

  return vacancies.map((v) => ({ ...v, applyUrl: found.get(v.id) ?? null }));
}
