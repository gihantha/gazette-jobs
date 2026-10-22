/**
 * Tests for the pure logic that decides what the board shows.
 *
 * These cover the decisions that are easy to get wrong and impossible to spot
 * by eye once there are 200 rows: timezone handling on deadlines, the date
 * formats the sources actually emit, exam stream detection, and the
 * cross-source dedupe rules.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { daysUntil, isStillOpen, parseClosingDate, todayInColombo } from "../lib/dates";
import { classifyExam, consolidate, splitTitleAndInstitution } from "../lib/scrape/normalize";
import type { Vacancy } from "../lib/types";

// --------------------------------------------------------------- date parsing

test("parses the ISO form governmentjobs.lk emits", () => {
  assert.equal(parseClosingDate("Closing Date: 2026-10-16"), "2026-10-16");
});

test("parses govdoc's nbsp-separated form", () => {
  assert.equal(parseClosingDate("Closing Date : 2026-10-18"), "2026-10-18");
});

test("parses the dotted form used in gazette amendments", () => {
  assert.equal(parseClosingDate("2026.11.12"), "2026-11-12");
});

test("parses long and short day-first dates", () => {
  assert.equal(parseClosingDate("12 November 2026"), "2026-11-12");
  assert.equal(parseClosingDate("6 Oct 2026"), "2026-10-06");
  assert.equal(parseClosingDate("28th September 2026"), "2026-09-28");
});

test("parses month-first dates", () => {
  assert.equal(parseClosingDate("November 12, 2026"), "2026-11-12");
});

test("reads bare slash dates day-first, per local convention", () => {
  // 12/11/2026 is 12 November in Sri Lanka, not 11 December.
  assert.equal(parseClosingDate("12/11/2026"), "2026-11-12");
});

test("rejects junk and impossible dates rather than guessing", () => {
  assert.equal(parseClosingDate(""), null);
  assert.equal(parseClosingDate(null), null);
  assert.equal(parseClosingDate("Closing Date: see gazette"), null);
  assert.equal(parseClosingDate("2026-02-31"), null);
  assert.equal(parseClosingDate("2026-13-01"), null);
});

// ------------------------------------------------------------------ timezones

test("today is computed in Colombo, not UTC", () => {
  // 19:00 UTC on 15 Oct is already 00:30 on 16 Oct in Colombo (UTC+5:30).
  // Getting this wrong expires same-day listings hours early.
  assert.equal(todayInColombo(new Date("2026-10-15T19:00:00Z")), "2026-10-16");

  // 02:00 UTC on 16 Oct is still 07:30 on the 16th in Colombo.
  assert.equal(todayInColombo(new Date("2026-10-16T02:00:00Z")), "2026-10-16");
});

test("a vacancy closing today is still open", () => {
  assert.equal(isStillOpen("2026-10-15", "2026-10-15"), true);
  assert.equal(isStillOpen("2026-10-14", "2026-10-15"), false);
  assert.equal(isStillOpen("2026-10-16", "2026-10-15"), true);
});

test("a missing deadline counts as open rather than being hidden", () => {
  assert.equal(isStillOpen(null, "2026-10-15"), true);
});

test("daysUntil counts whole calendar days", () => {
  assert.equal(daysUntil("2026-10-15", "2026-10-15"), 0);
  assert.equal(daysUntil("2026-10-16", "2026-10-15"), 1);
  assert.equal(daysUntil("2026-11-12", "2026-10-15"), 28);
  assert.equal(daysUntil("2026-10-14", "2026-10-15"), -1);
});

// ------------------------------------------------------------- exam detection

test("detects the open stream", () => {
  const r = classifyExam("Management Service Officer (Open)");
  assert.equal(r.isExam, true);
  assert.equal(r.examStream, "open");
});

test("detects the limited stream", () => {
  const r = classifyExam("Assistant Commissioner of Labour (Limited)");
  assert.equal(r.isExam, true);
  assert.equal(r.examStream, "limited");
});

test("treats a departmental exam as limited", () => {
  assert.equal(classifyExam("Audit Officer (Departmental)").examStream, "limited");
});

test("recognises spelled-out competitive exams", () => {
  const r = classifyExam(
    "Open Competitive Examination for Recruitment to Grade III of the Sri Lanka Foreign Service",
  );
  assert.equal(r.isExam, true);
  assert.equal(r.examStream, "open");
});

test("an ordinary vacancy is not an exam", () => {
  const r = classifyExam("Heavy Vehicle Driver");
  assert.equal(r.isExam, false);
  assert.equal(r.examStream, null);
});

// ------------------------------------------------------- title / institution

test("splits the trailing institution off a combined title", () => {
  assert.deepEqual(splitTitleAndInstitution("Management Assistant, Driver - Ministry of Transport"), {
    post: "Management Assistant, Driver",
    institution: "Ministry of Transport",
  });
});

test("does not mistake a post qualifier for an institution", () => {
  // "Planning & Design" is part of the role, not an employer.
  const r = splitTitleAndInstitution("Civil Engineer - Planning & Design");
  assert.equal(r.institution, "Unknown");
  assert.equal(r.post, "Civil Engineer - Planning & Design");
});

// ---------------------------------------------------------------- consolidate

const TODAY = "2026-10-15";

function vacancy(over: Partial<Vacancy>): Vacancy {
  // Note: `closingDate` is spread rather than defaulted with `??`, because a
  // null deadline is a meaningful value here and `??` would silently replace
  // it with the fallback date.
  return {
    id: over.id ?? Math.random().toString(36),
    source: "govdoc",
    sourceId: "x",
    title: "Driver",
    institution: "Somewhere",
    closingDate: "2026-10-20",
    url: "https://example.test/",
    logoUrl: null,
    category: null,
    isExam: false,
    examStream: null,
    applyUrl: null,
    scrapedAt: new Date().toISOString(),
    ...over,
  };
}

test("drops vacancies whose deadline has passed", () => {
  const { vacancies, expiredDropped } = consolidate(
    [
      vacancy({ id: "a", closingDate: "2026-10-14" }),
      vacancy({ id: "b", closingDate: "2026-10-15" }),
      vacancy({ id: "c", closingDate: "2026-10-16" }),
    ],
    TODAY,
  );
  assert.equal(expiredDropped, 1);
  assert.deepEqual(vacancies.map((v) => v.id), ["b", "c"]);
});

test("merges the same post listed by two sources under different institution wording", () => {
  const { vacancies } = consolidate(
    [
      vacancy({
        id: "a", source: "govdoc", title: "Management Service Officer (Open)",
        institution: "Central Provincial Council", closingDate: "2026-10-16",
      }),
      vacancy({
        id: "b", source: "governmentjobs", title: "Management Service Officer (Open)",
        institution: "Central Provincial Public Service", closingDate: "2026-10-16",
      }),
    ],
    TODAY,
  );
  assert.equal(vacancies.length, 1);
});

test("merges when one institution name merely extends the other", () => {
  const { vacancies } = consolidate(
    [
      vacancy({ id: "a", title: "ICT Officer (Open)", institution: "Southern Provincial Public Service" }),
      vacancy({ id: "b", title: "ICT Officer (Open)", institution: "Southern Provincial Public Service Commission" }),
    ],
    TODAY,
  );
  assert.equal(vacancies.length, 1);
});

test("ignores a parenthesised acronym when matching institutions", () => {
  const { vacancies } = consolidate(
    [
      vacancy({ id: "a", title: "Director", institution: "Eastern University Sri Lanka (EUSL)" }),
      vacancy({ id: "b", title: "Director", institution: "Eastern University, Sri Lanka" }),
    ],
    TODAY,
  );
  assert.equal(vacancies.length, 1);
});

test("keeps different provinces apart even when title and date match", () => {
  // The regression this guards: both reduce to {provincial, council} plus a
  // region word, and provincial recruitments really do share titles and dates.
  const { vacancies } = consolidate(
    [
      vacancy({ id: "a", title: "Development Officer (Open)", institution: "Central Provincial Council" }),
      vacancy({ id: "b", title: "Development Officer (Open)", institution: "Southern Provincial Council" }),
    ],
    TODAY,
  );
  assert.equal(vacancies.length, 2);
});

test("keeps North Central distinct from Central", () => {
  const { vacancies } = consolidate(
    [
      vacancy({ id: "a", title: "Internal Audit Officer (Open)", institution: "North Central Province Public Service Commission" }),
      vacancy({ id: "b", title: "Internal Audit Officer (Open)", institution: "Central Province Public Service Commission" }),
    ],
    TODAY,
  );
  assert.equal(vacancies.length, 2);
});

test("keeps unrelated posts that merely share a common title", () => {
  const { vacancies } = consolidate(
    [
      vacancy({ id: "a", title: "Driver", institution: "Ministry of Health" }),
      vacancy({ id: "b", title: "Driver", institution: "University of Colombo" }),
    ],
    TODAY,
  );
  assert.equal(vacancies.length, 2);
});

test("when merging, keeps the record with the richer detail", () => {
  const { vacancies } = consolidate(
    [
      vacancy({ id: "sparse", title: "Director", institution: "Eastern University", category: null, logoUrl: null }),
      vacancy({ id: "rich", title: "Director", institution: "Eastern University (EUSL)", category: "University", logoUrl: "https://x.test/l.png" }),
    ],
    TODAY,
  );
  assert.equal(vacancies.length, 1);
  assert.equal(vacancies[0].id, "rich");
});

test("sorts soonest deadline first and undated rows last", () => {
  const { vacancies } = consolidate(
    [
      vacancy({ id: "late", title: "A", institution: "X One", closingDate: "2026-12-01" }),
      vacancy({ id: "none", title: "B", institution: "X Two", closingDate: null }),
      vacancy({ id: "soon", title: "C", institution: "X Three", closingDate: "2026-10-16" }),
    ],
    TODAY,
  );
  assert.deepEqual(vacancies.map((v) => v.id), ["soon", "late", "none"]);
});

// ------------------------------------------------------------ apply link

import { extractApplyUrl } from "../lib/scrape/applyUrl";

const PAGE = "https://job.govdoc.lk/lecturer-ousl-9476";

test("finds the external Apply button", () => {
  const html = `<nav><a href="https://job.govdoc.lk/cv-format">Model Applications</a></nav>
    <a class="btn" href="https://forms.example.lk/apply?id=1">
      Apply
    </a>`;
  assert.equal(extractApplyUrl(html, PAGE), "https://forms.example.lk/apply?id=1");
});

test("returns null when the page has no Apply link", () => {
  const html = `<a href="https://job.govdoc.lk/cv-format">Model Applications &amp; CV Formats</a>`;
  assert.equal(extractApplyUrl(html, PAGE), null);
});

test("ignores Apply links back into the same site and non-web links", () => {
  const html = `<a href="/jobs">Apply</a><a href="mailto:hr@example.lk">Apply</a>`;
  assert.equal(extractApplyUrl(html, PAGE), null);
});

test("does not treat 'Applications' text as an Apply button", () => {
  const html = `<a href="https://elsewhere.test/">Download Applications</a>`;
  assert.equal(extractApplyUrl(html, PAGE), null);
});

// ------------------------------------------------------------------ calendar

import { buildIcs } from "../lib/calendar";

test("builds an all-day event on the closing date, ending the next day", () => {
  const ics = buildIcs(
    vacancy({ id: "govdoc:9", title: "Audit Officer", institution: "Audit Commission", closingDate: "2026-10-31" }),
    new Date("2026-10-22T10:00:00Z"),
  )!;
  assert.match(ics, /DTSTART;VALUE=DATE:20261031\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261101\r\n/); // exclusive end, crosses the month
  assert.match(ics, /DTSTAMP:20261022T100000Z\r\n/);
  assert.match(ics, /UID:govdoc_9@gazette-jobs\r\n/);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR") && ics.endsWith("END:VCALENDAR\r\n"));
});

test("rolls the end date over a year boundary", () => {
  const ics = buildIcs(vacancy({ closingDate: "2026-12-31" }))!;
  assert.match(ics, /DTEND;VALUE=DATE:20270101\r\n/);
});

test("gives no calendar file when there is no deadline", () => {
  assert.equal(buildIcs(vacancy({ closingDate: null })), null);
});

test("escapes commas and semicolons and folds long lines", () => {
  const ics = buildIcs(
    vacancy({ title: "Clerk, Typist; Driver", institution: "X".repeat(120) }),
  )!;
  assert.ok(ics.includes(String.raw`SUMMARY:Closing: Clerk\, Typist\; Driver`));
  for (const line of ics.split("\r\n")) {
    assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
  }
});

// ------------------------------------------------------------------- filters

import { DEFAULT_FILTERS, filtersToSearch, parseFilters } from "../lib/filters";
import { jobPath } from "../lib/site";

test("default filters produce an empty query string", () => {
  assert.equal(filtersToSearch(DEFAULT_FILTERS), "");
});

test("filters survive a round trip through the URL", () => {
  const f = { q: "driver & clerk", exam: "open" as const, within: 7 as const, online: true };
  assert.deepEqual(parseFilters(new URLSearchParams(filtersToSearch(f))), f);
});

test("unknown or tampered filter values fall back to defaults", () => {
  const f = parseFilters(new URLSearchParams("exam=bogus&within=999&apply=nope&q="));
  assert.deepEqual(f, DEFAULT_FILTERS);
});

test("an over-long search term is capped", () => {
  const f = parseFilters(new URLSearchParams({ q: "x".repeat(500) }));
  assert.equal(f.q.length, 100);
});

test("job paths encode ids that contain colons and base64 padding", () => {
  assert.equal(jobPath("govdoc:9518"), "/jobs/govdoc%3A9518");
  assert.equal(jobPath("governmentjobs:lpygm6g="), "/jobs/governmentjobs%3Alpygm6g%3D");
});

// -------------------------------------------------------------------- health

import { assessHealth } from "../lib/health";
import { notifyTelegram } from "../lib/notify";
import type { ScrapeReport, ScrapeResult } from "../lib/types";

function result(over: Partial<ScrapeResult>): ScrapeResult {
  return {
    source: "govdoc",
    vacancies: [vacancy({}), vacancy({}), vacancy({}), vacancy({})],
    warnings: [],
    durationMs: 1,
    ...over,
  };
}

function report(...results: ScrapeResult[]): ScrapeReport {
  return {
    startedAt: "", finishedAt: "", durationMs: 1, results, totalVacancies: 0, expiredDropped: 0,
  };
}

test("a clean run is healthy", () => {
  const h = assessHealth(report(result({ source: "govdoc" }), result({ source: "governmentjobs" })));
  assert.deepEqual(h, { ok: true, problems: [] });
});

test("a source that threw is reported even when the other source is fine", () => {
  const h = assessHealth(
    report(result({ source: "govdoc", vacancies: [], error: "markup has probably changed" }), result({ source: "governmentjobs" })),
  );
  assert.equal(h.ok, false);
  assert.equal(h.problems.length, 1);
  assert.match(h.problems[0], /govdoc: failed — markup has probably changed/);
});

test("a source that 'succeeds' with zero vacancies is unhealthy", () => {
  const h = assessHealth(report(result({ vacancies: [] })));
  assert.equal(h.ok, false);
  assert.match(h.problems[0], /returned 0 vacancies/);
});

test("mostly-unparseable cards are flagged, a few warnings are not", () => {
  const few = assessHealth(report(result({ warnings: ["one odd date"] }))); // 1 per 4 = 0.25
  assert.equal(few.ok, true);

  const many = assessHealth(report(result({ warnings: ["a", "b"] }))); // 2 per 4 = 0.5
  assert.equal(many.ok, false);
  assert.match(many.problems[0], /2 parse warnings for 4 vacancies/);
});

test("telegram alert does nothing without configuration", async () => {
  const saved = [process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID];
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  try {
    assert.equal(await notifyTelegram("hello"), false);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
    if (saved[0] !== undefined) process.env.TELEGRAM_BOT_TOKEN = saved[0];
    if (saved[1] !== undefined) process.env.TELEGRAM_CHAT_ID = saved[1];
  }
});

test("telegram alert posts the message, and never throws when the request fails", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "TESTTOKEN";
  process.env.TELEGRAM_CHAT_ID = "42";
  const realFetch = globalThis.fetch;
  const calls: { url: string; body: string }[] = [];
  try {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    assert.equal(await notifyTelegram("x".repeat(5000)), true);
    assert.equal(calls[0].url, "https://api.telegram.org/botTESTTOKEN/sendMessage");
    assert.equal(JSON.parse(calls[0].body).text.length, 4000);
    assert.equal(JSON.parse(calls[0].body).chat_id, "42");

    globalThis.fetch = (async () => { throw new Error("network down https://api.telegram.org/botTESTTOKEN"); }) as typeof fetch;
    assert.equal(await notifyTelegram("hi"), false);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  }
});
