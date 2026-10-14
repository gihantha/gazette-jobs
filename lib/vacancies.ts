/**
 * The single read path the UI uses.
 *
 * Prefers Postgres. Falls back to scraping live when no database is
 * configured, so a fresh clone renders real data immediately — and also falls
 * back when the database is configured but still empty (i.e. before the first
 * cron run has fired on a new deployment).
 */
import { unstable_cache } from "next/cache";
import { getLastScrapeAt, getOpenVacancies, hasDatabase } from "./db";
import { scrapeAll } from "./scrape";
import { todayInColombo } from "./dates";
import type { Vacancy } from "./types";

export interface Board {
  vacancies: Vacancy[];
  today: string;
  lastUpdated: string | null;
  /** Where these rows came from, surfaced in the footer for transparency. */
  mode: "database" | "live-scrape";
  degraded: boolean;
}

/**
 * Live scraping is wrapped in Next's data cache so that, in the no-database
 * mode, concurrent visitors share one scrape instead of each triggering their
 * own 16-second crawl of the upstream sites.
 */
const cachedLiveScrape = unstable_cache(
  async () => {
    const { vacancies, report } = await scrapeAll();
    return { vacancies, finishedAt: report.finishedAt };
  },
  ["live-scrape-v1"],
  { revalidate: 3600, tags: ["vacancies"] },
);

export async function getBoard(): Promise<Board> {
  const today = todayInColombo();

  if (hasDatabase) {
    try {
      const vacancies = await getOpenVacancies(today);
      if (vacancies.length > 0) {
        return {
          vacancies,
          today,
          lastUpdated: await getLastScrapeAt(),
          mode: "database",
          degraded: false,
        };
      }
      // Configured but empty — fall through to a live scrape so the very first
      // page view after deploy is not a blank board.
    } catch (err) {
      console.error("[vacancies] database read failed, falling back to live scrape:", err);
    }
  }

  try {
    const { vacancies, finishedAt } = await cachedLiveScrape();
    return {
      vacancies,
      today,
      lastUpdated: finishedAt,
      mode: "live-scrape",
      degraded: hasDatabase,
    };
  } catch (err) {
    console.error("[vacancies] live scrape failed:", err);
    return { vacancies: [], today, lastUpdated: null, mode: "live-scrape", degraded: true };
  }
}
