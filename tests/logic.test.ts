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
