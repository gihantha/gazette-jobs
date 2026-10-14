/**
 * Postgres persistence, with a deliberate no-database fallback.
 *
 * Why persist at all when we could scrape on demand? Two reasons:
 *   1. Last-known-good. If a source goes down mid-week, the board keeps
 *      serving the rows we already have instead of emptying out.
 *   2. Speed. A full scrape takes ~16s; serving from Postgres is ~10ms, so
 *      page loads never wait on four upstream sites.
 *
 * When DATABASE_URL is unset (a fresh clone, before you provision anything)
 * every function here no-ops and the app falls back to live scraping with
 * Next.js caching. That keeps `npm run dev` working with zero setup.
 */
import postgres from "postgres";
import type { ScrapeReport, Vacancy } from "./types";

const DATABASE_URL = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

export const hasDatabase = Boolean(DATABASE_URL);

// Reuse the client across hot reloads in dev and across warm lambda
// invocations in production, or we leak a connection pool per request.
const globalForDb = globalThis as unknown as { __sql?: postgres.Sql };

function client(): postgres.Sql {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!globalForDb.__sql) {
    globalForDb.__sql = postgres(DATABASE_URL, {
      // Serverless: keep the pool tiny and let idle connections go.
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: DATABASE_URL.includes("localhost") ? false : "require",
    });
  }
  return globalForDb.__sql;
}

export const sql = client;

/** Create tables and indexes. Safe to run repeatedly. */
export async function initSchema(): Promise<void> {
  const db = client();

  await db`
    CREATE TABLE IF NOT EXISTS vacancies (
      id            TEXT PRIMARY KEY,
      source        TEXT NOT NULL,
      source_id     TEXT NOT NULL,
      title         TEXT NOT NULL,
      institution   TEXT NOT NULL,
      closing_date  DATE,
      url           TEXT NOT NULL,
      logo_url      TEXT,
      category      TEXT,
      is_exam       BOOLEAN NOT NULL DEFAULT FALSE,
      exam_stream   TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      scraped_at    TIMESTAMPTZ NOT NULL
    )
  `;

  // The board's primary query is "open, soonest first".
  await db`CREATE INDEX IF NOT EXISTS vacancies_closing_idx ON vacancies (closing_date)`;
  await db`CREATE INDEX IF NOT EXISTS vacancies_exam_idx ON vacancies (is_exam, exam_stream)`;

  await db`
    CREATE TABLE IF NOT EXISTS scrape_runs (
      id            BIGSERIAL PRIMARY KEY,
      started_at    TIMESTAMPTZ NOT NULL,
      finished_at   TIMESTAMPTZ NOT NULL,
      duration_ms   INTEGER NOT NULL,
      total         INTEGER NOT NULL,
      expired       INTEGER NOT NULL,
      report        JSONB NOT NULL
    )
  `;
}

/**
 * Upsert the scraped rows.
 *
 * `first_seen_at` is preserved on conflict so the UI can show "new this week".
 * Rows absent from this run are left alone rather than deleted — a source
 * dropping a listing early should not erase a deadline the user is tracking;
 * expiry is decided by `closing_date`, not by presence in the latest scrape.
 */
export async function upsertVacancies(vacancies: Vacancy[]): Promise<number> {
  if (!hasDatabase || vacancies.length === 0) return 0;
  const db = client();

  const rows = vacancies.map((v) => ({
    id: v.id,
    source: v.source,
    source_id: v.sourceId,
    title: v.title,
    institution: v.institution,
    closing_date: v.closingDate,
    url: v.url,
    logo_url: v.logoUrl,
    category: v.category,
    is_exam: v.isExam,
    exam_stream: v.examStream,
    scraped_at: v.scrapedAt,
  }));

  // Chunked so a big run stays well inside Postgres' parameter limit.
  const CHUNK = 200;
  let written = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db`
      INSERT INTO vacancies ${db(
        chunk,
        "id", "source", "source_id", "title", "institution", "closing_date",
        "url", "logo_url", "category", "is_exam", "exam_stream", "scraped_at",
      )}
      ON CONFLICT (id) DO UPDATE SET
        title        = EXCLUDED.title,
        institution  = EXCLUDED.institution,
        closing_date = EXCLUDED.closing_date,
        url          = EXCLUDED.url,
        logo_url     = EXCLUDED.logo_url,
        category     = EXCLUDED.category,
        is_exam      = EXCLUDED.is_exam,
        exam_stream  = EXCLUDED.exam_stream,
        scraped_at   = EXCLUDED.scraped_at
    `;
    written += chunk.length;
  }

  return written;
}

/** Read every vacancy still open as of `today` (a Colombo `YYYY-MM-DD`). */
export async function getOpenVacancies(today: string): Promise<Vacancy[]> {
  if (!hasDatabase) return [];
  const db = client();

  const rows = await db<
    {
      id: string; source: string; source_id: string; title: string;
      institution: string; closing_date: Date | null; url: string;
      logo_url: string | null; category: string | null; is_exam: boolean;
      exam_stream: string | null; scraped_at: Date;
    }[]
  >`
    SELECT id, source, source_id, title, institution, closing_date, url,
           logo_url, category, is_exam, exam_stream, scraped_at
    FROM vacancies
    WHERE closing_date IS NULL OR closing_date >= ${today}::date
    ORDER BY closing_date ASC NULLS LAST, institution ASC, title ASC
  `;

  return rows.map((r) => ({
    id: r.id,
    source: r.source as Vacancy["source"],
    sourceId: r.source_id,
    title: r.title,
    institution: r.institution,
    // node-postgres hands back a Date for DATE columns; take the calendar part
    // only, in UTC, so no timezone shift creeps into the deadline.
    closingDate: r.closing_date ? r.closing_date.toISOString().slice(0, 10) : null,
    url: r.url,
    logoUrl: r.logo_url,
    category: r.category,
    isExam: r.is_exam,
    examStream: r.exam_stream as Vacancy["examStream"],
    scrapedAt: r.scraped_at.toISOString(),
  }));
}

export async function recordScrapeRun(report: ScrapeReport): Promise<void> {
  if (!hasDatabase) return;
  const db = client();
  await db`
    INSERT INTO scrape_runs (started_at, finished_at, duration_ms, total, expired, report)
    VALUES (
      ${report.startedAt}, ${report.finishedAt}, ${report.durationMs},
      ${report.totalVacancies}, ${report.expiredDropped}, ${db.json(report as never)}
    )
  `;
}

/** Timestamp of the most recent successful scrape, for the "updated" line. */
export async function getLastScrapeAt(): Promise<string | null> {
  if (!hasDatabase) return null;
  const db = client();
  const rows = await db<{ finished_at: Date }[]>`
    SELECT finished_at FROM scrape_runs ORDER BY id DESC LIMIT 1
  `;
  return rows[0]?.finished_at.toISOString() ?? null;
}

/** Delete rows whose deadline passed more than `days` ago. */
export async function pruneExpired(days = 30): Promise<number> {
  if (!hasDatabase) return 0;
  const db = client();
  const rows = await db`
    DELETE FROM vacancies
    WHERE closing_date IS NOT NULL
      AND closing_date < (CURRENT_DATE - ${days}::integer)
    RETURNING id
  `;
  return rows.length;
}
