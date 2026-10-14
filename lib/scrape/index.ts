import type { ScrapeReport, ScrapeResult, Vacancy } from "../types";
import { todayInColombo } from "../dates";
import { consolidate } from "./normalize";
import { scrapeGovernmentJobs } from "./sources/governmentjobs";
import { scrapeGovdoc } from "./sources/govdoc";

/**
 * Run every source and merge the results.
 *
 * Sources run in parallel but each throttles itself per host, so this is two
 * concurrent hosts rather than a burst. A source that fails is recorded in the
 * report and skipped — one site being down must not empty the board.
 */
export async function scrapeAll(): Promise<{ report: ScrapeReport; vacancies: Vacancy[] }> {
  const startedAt = new Date();
  const today = todayInColombo(startedAt);

  const settled = await Promise.allSettled([scrapeGovernmentJobs(), scrapeGovdoc()]);

  const results: ScrapeResult[] = settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") return outcome.value;
    return {
      source: i === 0 ? "governmentjobs" : "govdoc",
      vacancies: [],
      warnings: [],
      error:
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      durationMs: 0,
    };
  });

  const { vacancies, expiredDropped } = consolidate(
    results.flatMap((r) => r.vacancies),
    today,
  );

  const finishedAt = new Date();

  return {
    report: {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      results,
      totalVacancies: vacancies.length,
      expiredDropped,
    },
    vacancies,
  };
}
