import { getBoard } from "@/lib/vacancies";
import { JobBoard } from "./JobBoard";

/**
 * Rebuild at most every 30 minutes. The cron job also busts the cache tag the
 * moment it finishes, so a fresh scrape shows up immediately rather than
 * waiting out this window.
 */
export const revalidate = 1800;

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
