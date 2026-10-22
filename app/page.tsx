import { getBoard } from "@/lib/vacancies";
import { JobBoard } from "./JobBoard";

/**
 * Rebuild at most every 30 minutes. The cron job also busts the cache tag the
 * moment it finishes, so a fresh scrape shows up immediately rather than
 * waiting out this window.
 */
export const revalidate = 1800;

// With no database, a cache refresh re-scrapes the sources and fetches some
// detail pages, which needs more than the 10s default. 60s is allowed on Hobby.
export const maxDuration = 60;

export default async function Page() {
  const board = await getBoard();

  return (
    <main className="shell">
      <JobBoard
        vacancies={board.vacancies}
        today={board.today}
        lastUpdated={board.lastUpdated}
        mode={board.mode}
        degraded={board.degraded}
      />
    </main>
  );
}
