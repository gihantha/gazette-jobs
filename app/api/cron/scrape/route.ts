/**
 * Scheduled scrape. Wired to Vercel Cron in `vercel.json`.
 *
 * Vercel invokes cron paths with a bearer token equal to CRON_SECRET when that
 * env var is set, which is the documented way to stop anyone on the internet
 * from triggering a 16-second crawl of the upstream sites on demand.
 */
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { scrapeAll } from "@/lib/scrape";
import { assessHealth } from "@/lib/health";
import { notifyTelegram, telegramConfigured } from "@/lib/notify";
import { hasDatabase, initSchema, pruneExpired, recordScrapeRun, upsertVacancies } from "@/lib/db";

// The crawl is deliberately throttled and takes ~20s, so it needs more than
// the 10s default. 60s is available on every Vercel plan including Hobby.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const { report, vacancies } = await scrapeAll();

  let saved = 0;
  let pruned = 0;
  let dbError: string | null = null;

  if (hasDatabase) {
    try {
      await initSchema();
      saved = await upsertVacancies(vacancies);
      pruned = await pruneExpired(30);
      await recordScrapeRun(report);
    } catch (err) {
      dbError = err instanceof Error ? err.message : String(err);
      console.error("[cron] persistence failed:", err);
    }
  }

  // Drop the cached live-scrape so the next request sees fresh rows.
  revalidateTag("vacancies");

  const health = assessHealth(report);
  let alerted = false;

  if (!health.ok) {
    console.error("[cron] scrape unhealthy:", health.problems);
    // Runs once a day, so this is at most one message a day.
    alerted = await notifyTelegram(
      `Gazette Jobs: scrape problem\n\n${health.problems.map((p) => `• ${p}`).join("\n")}`,
    );
  }

  return NextResponse.json(
    {
      ok: health.ok && !dbError,
      problems: health.problems,
      alerted,
      alertingConfigured: telegramConfigured,
      persisted: hasDatabase,
      saved,
      pruned,
      dbError,
      ...report,
    },
    // Signal failure to Vercel's cron monitoring so a broken scrape is visible
    // in the dashboard rather than silently returning 200. Any unhealthy source
    // counts, not just all of them: one dead source already means missing jobs.
    { status: health.ok ? 200 : 500 },
  );
}
