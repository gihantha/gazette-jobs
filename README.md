# Sri Lanka Gazette Jobs

A self-updating board of Sri Lankan government vacancies that **automatically hides
anything whose application deadline has passed**.

Scrapes two gazette aggregators daily, normalises and de-duplicates the results, flags
open vs limited competitive examinations, marks posts that have a direct online
application link, and serves the live list as a web page and a JSON API.

> **This deployment runs on Vercel only — no database.** There is no budget for one, so
> `DATABASE_URL` is left unset and everything is served from a live scrape held in
> Vercel's built-in data cache. The Postgres code in `lib/db.ts` is optional and unused.

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
npm test                # 46 tests over the date, exam, dedupe, apply-link, calendar, filter and health logic
npm run typecheck
```

---

## How it works

```
Vercel Cron (once daily, 06:30 Colombo)
   └─> GET /api/cron/scrape
         ├─ scrape governmentjobs.lk   (1 request, ?ipp=All)
         ├─ scrape job.govdoc.lk       (paginated, stops when pages run dry)
         ├─ normalise + dedupe + drop expired
         └─ revalidateTag("vacancies")   -> expires the cached live scrape

Page load (cached for 30 min)
   └─> getBoard()
         ├─ live scrape            (Vercel data cache, refreshed after the cron)
         └─ enrichApplyLinks()     (per-job cache, max 20 new fetches per refresh)

With DATABASE_URL set (not used in this deployment), getBoard() reads Postgres first.
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

### Apply-online links

The listing pages do not say how to apply. Only some `job.govdoc.lk` **detail** pages have
an external "Apply" button, so `lib/scrape/enrich.ts` fetches those pages and stores the
link as `applyUrl`. The UI shows an "Apply online" chip and filter for them.

- **No `applyUrl` means unknown, not "apply by post".** Neither source reliably states
  registered post or email; governmentjobs.lk publishes its notice only as an image, so it
  never gets a link. Do not infer a method from a missing link.
- **No database, so results live in Vercel's data cache**, one entry per job for 3 days.
  A cold cache would need ~150 throttled requests, so each refresh fetches at most 20 new
  detail pages, soonest deadline first. Coverage therefore fills in over the first few
  refreshes after a deploy (~35 s per refresh, inside the 60 s `maxDuration`).
- The enrichment runs *outside* the tagged `vacancies` cache on purpose: inside it, the
  daily `revalidateTag` would also discard every stored link.

### Scrape health alerts

The scrapers read HTML we do not control, so the likely failure is silent: a redesign makes
a scraper find nothing and the board quietly goes stale. After each daily cron run,
`lib/health.ts` flags a source that **threw**, returned **zero vacancies**, or **failed to
parse more than 30% of its cards**.

- An unhealthy run returns **HTTP 500** from `/api/cron/scrape`, which shows as a failed run
  in Vercel's cron log. (Before, only "every source failed" did.) The response lists
  `problems`.
- Optionally, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (see `.env.example`) to also
  get a Telegram message — at most one a day. Unset, the alert is skipped and nothing else
  changes.
- It cannot notice a source that returns plausible-looking but wrong data, or a drop from
  300 to 30 rows; with no database there is no previous run to compare against.

### Shareable links

- **Filters are in the URL** (`?exam=open&within=7&apply=online&q=audit`), so any filtered
  view can be shared and survives a reload. Unknown or tampered values fall back to the
  defaults (`lib/filters.ts`). "Saved only" is left out on purpose: saved posts live in one
  browser, so a shared link to them would show someone else an empty list.
- **Each vacancy has its own page** at `/jobs/<id>` with a title and description for link
  previews (WhatsApp, Telegram, Google). The 🔗 button on every row shares it, using the
  phone's share sheet when available and copying the link otherwise. Once a post closes it
  leaves the board and its page returns 404.
- **`/sitemap.xml` and `/robots.txt`** list every open post. They use
  `NEXT_PUBLIC_SITE_URL`, or Vercel's production hostname when that is unset — set it once
  there is a custom domain.
- No `JobPosting` structured data: the sources give no posting date or description, and
  incomplete markup is worse than none.

### Saved jobs and calendar

Each row has a star and a calendar button. Both work entirely in the browser, so they cost
nothing to run and need no account or database:

- **Saved jobs** are kept in `localStorage` (`app/useSavedJobs.ts`) and are
  per browser — they do not follow the user to another device. A saved post that closes
  simply stops appearing.
- **Add to calendar** builds an all-day `.ics` event on the closing date with a reminder the
  day before (`lib/calendar.ts`). Posts with no published deadline have no calendar button.

### Open vs limited exams

`classifyExam()` reads the stream out of the title: `(Open)` → open competitive exam
(anyone qualified may apply), `(Limited)` / `(Departmental)` → restricted to serving
public officers. The board filters on this.

---

## Deploying to Vercel

1. **Push to GitHub**, then import the repo at [vercel.com/new](https://vercel.com/new).
2. **Do not add a database.** Leave `DATABASE_URL` unset; the site runs on the live
   scrape and Vercel's data cache. *(If a budget appears later, Storage → Postgres
   (Neon) injects `DATABASE_URL` and `lib/db.ts` takes over.)*
3. **Set `CRON_SECRET`** under *Settings → Environment Variables* to any long random
   string. Vercel sends it as a bearer token on cron calls; without it, anyone can
   trigger a crawl of the upstream sites.
4. **Deploy.** `vercel.json` registers the cron at `0 1 * * *` UTC (06:30 Colombo) — the
   most the Hobby plan allows.
5. **Warm it up** by opening the site once. The first load runs the scrape and takes
   ~40 s; after that visitors get the cached page.

---

## JSON API

| Query | Returns |
|---|---|
| `GET /api/jobs` | every vacancy still open |
| `GET /api/jobs?exam=open` | open competitive exams only |
| `GET /api/jobs?exam=limited` | limited / departmental exams |
| `GET /api/jobs?exam=any` | anything flagged as an exam |
| `GET /api/jobs?apply=online` | only posts with a direct application link |
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
      "applyUrl": null, // direct application link, when the listing page has one
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
    enrich.ts           per-job apply links, cached in Vercel's data cache
    applyUrl.ts         pulls the "Apply" link out of a detail page
    http.ts             throttled fetch
    normalize.ts        exam detection, dedupe, sorting
    sources/*.ts        one adapter per site
tests/logic.test.ts
scripts/                scrape-once, db-init
```
