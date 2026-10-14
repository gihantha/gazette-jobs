# Sri Lanka Gazette Jobs

A self-updating board of Sri Lankan government vacancies that **automatically hides
anything whose application deadline has passed**.

Scrapes two gazette aggregators three times a day, normalises and de-duplicates the
results, flags open vs limited competitive examinations, and serves the live list as
a web page and a JSON API.

```
197 open vacancies · 115 closing within 7 days · 22 open competitive exams
```

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. It works immediately with **no database and no API keys** —
with `DATABASE_URL` unset the app scrapes live and caches for an hour.

Useful commands:

```bash
npm run scrape          # scrape once, print a report, touch nothing
npm run scrape -- --json # dump the normalised vacancies as JSON
npm test                # 27 tests over the date, exam and dedupe logic
npm run typecheck
```

---

## How it works

```
Vercel Cron (3x daily)
   └─> GET /api/cron/scrape
         ├─ scrape governmentjobs.lk   (1 request, ?ipp=All)
         ├─ scrape job.govdoc.lk       (paginated, stops when pages run dry)
         ├─ normalise + dedupe + drop expired
         ├─ upsert into Postgres
         └─ revalidateTag("vacancies")

Page load
   └─> getBoard()
         ├─ Postgres (fast path, ~10ms)
         └─ live scrape fallback if no DB / DB empty / DB down
```

### Deciding what has expired

Deadlines are compared against **today in Asia/Colombo**, not UTC. This matters because
Vercel functions run in UTC: 19:00 UTC on the 15th is already 00:30 on the 16th in
Colombo, so a UTC clock would drop same-day listings hours early and keep others a day
too long. See `lib/dates.ts`.

A vacancy with **no published deadline is kept**, not hidden — the source simply did not
print one, and silently dropping those loses real jobs. The UI labels them "Check source".

### De-duplication

The two sources describe the same vacancy differently, so an exact match does not work:

| Source A | Source B |
|---|---|
| `Central Provincial Council` | `Central Provincial Public Service` |
| `Southern Provincial Public Service` | `… Public Service Commission` |
| `Eastern University Sri Lanka (EUSL)` | `Eastern University, Sri Lanka` |

Rows are bucketed on **post title + closing date**, then merged within a bucket only when
the institutions plausibly name the same body (one contains the other, or they share two
or more significant words). A **region veto** keeps `Central` / `Southern` /
`North Central` provincial bodies apart — they routinely share a post title *and* a
gazette closing date, so without it two separate provincial recruitments collapse into
one. Covered by tests.

### Open vs limited exams

`classifyExam()` reads the stream out of the title: `(Open)` → open competitive exam
(anyone qualified may apply), `(Limited)` / `(Departmental)` → restricted to serving
public officers. The board filters on this.

---

## Deploying to Vercel

1. **Push to GitHub**, then import the repo at [vercel.com/new](https://vercel.com/new).
2. **Add a database** — in the project, *Storage → Create → Postgres (Neon)*. Vercel
   injects `DATABASE_URL` automatically. *(Optional: skip it and the site still works,
   just slower.)*
3. **Set `CRON_SECRET`** under *Settings → Environment Variables* to any long random
   string. Vercel sends it as a bearer token on cron calls; without it, anyone can
   trigger a crawl of the upstream sites.
4. **Deploy.** `vercel.json` registers the cron at `0 1,7,13 * * *` UTC — 06:30, 12:30
   and 18:30 Colombo time.
5. **Seed the first run** by visiting `/api/cron/scrape` once (or wait for the first
   cron). The schema is created automatically on that call.

Local development against the real database:

```bash
vercel env pull .env.local
npm run db:init
npm run scrape -- --save
```

---

## JSON API

| Query | Returns |
|---|---|
| `GET /api/jobs` | every vacancy still open |
| `GET /api/jobs?exam=open` | open competitive exams only |
| `GET /api/jobs?exam=limited` | limited / departmental exams |
| `GET /api/jobs?exam=any` | anything flagged as an exam |
| `GET /api/jobs?within=7` | closing within 7 days |
| `GET /api/jobs?q=customs` | substring match on post or institution |

```jsonc
{
  "today": "2026-10-15",
  "lastUpdated": "2026-10-15T01:00:12.431Z",
  "mode": "database",
  "count": 22,
  "vacancies": [
    {
      "id": "govdoc:9412",
      "title": "Audit Officer (Open)",
      "institution": "Audit Service Commission",
      "closingDate": "2026-11-12",
      "isExam": true,
      "examStream": "open",
      "url": "https://job.govdoc.lk/audit-officer-open-audit-service-commission-9412"
      // …
    }
  ]
}
```

---

## Adding a source

1. Create `lib/scrape/sources/<name>.ts` exporting `async (): Promise<ScrapeResult>`.
2. Use `fetchText()` from `lib/scrape/http.ts` — it handles throttling, retries,
   timeouts and the User-Agent.
3. Return `Vacancy` rows with `id` set to `` `<source>:<theirId>` ``.
4. Add it to the `Promise.allSettled([...])` in `lib/scrape/index.ts` and to the
   `SourceId` union in `lib/types.ts`.

A source that throws is recorded in the report and skipped — one site being down must
never empty the board.

### Scraping etiquette

These are small aggregators. `lib/scrape/http.ts` enforces one request at a time per
host, a 700 ms gap between them, 3 bounded retries and a 15 s timeout. A full crawl is
~25 requests. Please keep the cron at a few runs a day rather than raising it — the data
changes daily at most, so more frequent scraping gains nothing and costs them bandwidth.

---

## Caveats

- **Sources are third-party aggregators, not the official gazette.** They occasionally
  lag amendments. Always confirm the closing date and eligibility against the gazette
  notice at [documents.gov.lk](http://www.documents.gov.lk/en/gazette.php) before
  applying.
- **Some deadlines are registered-post dates**, meaning the application must physically
  *arrive* by then, not be posted on it. The source listing rarely distinguishes this.
- **Selectors will break** when either site redesigns. Each scraper fails loudly with an
  explicit "markup has probably changed" error rather than silently returning zero rows,
  and that error surfaces in the cron response and the `scrape_runs` table.

## Layout

```
app/
  page.tsx              server component, reads the board
  JobBoard.tsx          client UI: search, filters, urgency grouping
  api/jobs/route.ts     public JSON API
  api/cron/scrape/route.ts  scheduled scrape (CRON_SECRET protected)
lib/
  dates.ts              Colombo timezone + the date formats sources emit
  db.ts                 Postgres, with a no-database fallback
  vacancies.ts          the single read path used by the UI
  types.ts
  scrape/
    index.ts            orchestrator
    http.ts             throttled fetch
    normalize.ts        exam detection, dedupe, sorting
    sources/*.ts        one adapter per site
tests/logic.test.ts
scripts/                scrape-once, db-init
```
