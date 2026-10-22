/**
 * Decide whether a scrape run looks healthy.
 *
 * Both sources are scraped from HTML we do not control, so the realistic
 * failure is silent: the markup changes, the scraper finds nothing, and the
 * board quietly goes stale. There is no database to compare against yesterday's
 * run, so the checks are ones that are wrong on their face:
 *
 *   - the source threw (network down, markup guard tripped), or
 *   - it "succeeded" but returned no vacancies, or
 *   - a large share of the cards it did find could not be parsed, which is what
 *     a partial redesign looks like.
 */
import type { ScrapeReport } from "./types";

/** Warnings per vacancy above which a source is considered half-broken. */
const MAX_WARNING_RATIO = 0.3;

export interface Health {
  ok: boolean;
  problems: string[];
}

export function assessHealth(report: ScrapeReport): Health {
  const problems: string[] = [];

  for (const r of report.results) {
    if (r.error) {
      problems.push(`${r.source}: failed — ${r.error}`);
      continue;
    }
    if (r.vacancies.length === 0) {
      problems.push(`${r.source}: returned 0 vacancies (markup may have changed)`);
      continue;
    }
    if (r.warnings.length / r.vacancies.length > MAX_WARNING_RATIO) {
      problems.push(
        `${r.source}: ${r.warnings.length} parse warnings for ${r.vacancies.length} vacancies` +
          ` (e.g. ${r.warnings[0]})`,
      );
    }
  }

  return { ok: problems.length === 0, problems };
}
