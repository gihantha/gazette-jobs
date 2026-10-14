import type { ExamStream, Vacancy } from "../types";
import { isStillOpen } from "../dates";

/**
 * Split "Management Assistant, Driver - Ministry of Transport" into its post
 * and institution halves.
 *
 * governmentjobs.lk only gives us one combined string. The separator is " - ",
 * and the institution is always last — but post names contain hyphens too
 * ("Civil Engineer - Planning & Design"), so we split on the *last* " - " and
 * only accept it when the tail looks like an organisation rather than a
 * qualifier.
 */
export function splitTitleAndInstitution(combined: string): {
  post: string;
  institution: string;
} {
  const idx = combined.lastIndexOf(" - ");
  if (idx <= 0) return { post: combined.trim(), institution: "Unknown" };

  const post = combined.slice(0, idx).trim();
  const tail = combined.slice(idx + 3).trim();

  if (looksLikeInstitution(tail)) return { post, institution: tail };
  return { post: combined.trim(), institution: "Unknown" };
}

const INSTITUTION_HINTS = [
  "ministry", "department", "university", "authority", "commission", "board",
  "corporation", "council", "institute", "bank", "company", "limited", "ltd",
  "agency", "service", "sri lanka", "national", "provincial", "campus",
  "secretariat", "foundation", "hospital", "centre", "center", "bureau",
  "pradeshiya sabha", "municipal", "fund", "office", "college", "school",
  "academy", "airlines", "catering", "navy", "army", "police", "railway",
  "trust", "society", "federation", "cooperative", "co-operative", "sabha",
  "institution", "organisation", "organization", "association", "chamber",
  "plantation", "research", "development", "divisional", "regional", "project",
];

function looksLikeInstitution(text: string): boolean {
  if (text.length < 3) return false;
  const lower = text.toLowerCase();
  if (INSTITUTION_HINTS.some((h) => lower.includes(h))) return true;
  // Acronym-only names like "BOI", "SLIDA", "NARA", "CPSTL".
  if (/^[A-Z][A-Za-z&.\- ]{1,40}$/.test(text) && text === text.toUpperCase()) return true;
  return false;
}

/**
 * Detect competitive examinations and, where stated, which stream.
 *
 * This is the distinction the user cares about: an "open" competitive exam
 * (විවෘත තරග විභාගය) is applied for by anyone meeting the qualifications,
 * whereas a "limited" one is restricted to serving public officers. Sources
 * mark it in the title, usually parenthesised: "Audit Officer (Open)".
 */
export function classifyExam(title: string): { isExam: boolean; examStream: ExamStream } {
  const lower = title.toLowerCase();

  const mentionsExam =
    /\bexam(ination)?s?\b/.test(lower) ||
    /\bcompetitive\b/.test(lower) ||
    /\befficiency bar\b/.test(lower);

  // "(Open)" / "Open Competitive" / "open exam"
  const isOpen =
    /\(\s*open[^)]*\)/.test(lower) ||
    /\bopen (competitive|recruitment|exam)/.test(lower);

  const isLimited =
    /\(\s*limited[^)]*\)/.test(lower) ||
    /\blimited (competitive|exam)/.test(lower) ||
    /\(\s*departmental\s*\)/.test(lower);

  // A bare "(Open)" tag marks an exam even when the word "exam" is absent —
  // that parenthetical is only ever used for competitive-exam recruitment.
  const isExam = mentionsExam || isOpen || isLimited;

  let examStream: ExamStream = null;
  if (isOpen && !isLimited) examStream = "open";
  else if (isLimited && !isOpen) examStream = "limited";

  return { isExam, examStream };
}

/**
 * Merge rows from every source into one list: drop expired deadlines, collapse
 * duplicates that appear on more than one site, and sort by urgency.
 */
export function consolidate(
  all: Vacancy[],
  today: string,
): { vacancies: Vacancy[]; expiredDropped: number } {
  const live: Vacancy[] = [];
  let expiredDropped = 0;

  for (const v of all) {
    if (isStillOpen(v.closingDate, today)) live.push(v);
    else expiredDropped++;
  }

  const vacancies = dedupe(live).sort(compareByUrgency);
  return { vacancies, expiredDropped };
}

/**
 * Collapse the same vacancy appearing on more than one source.
 *
 * Matching on an exact institution string does not work, because the sources
 * word them differently for the same body:
 *
 *   "Central Provincial Council"        vs "Central Provincial Public Service"
 *   "Southern Provincial Public Service" vs "Southern Provincial Public Service Commission"
 *   "Eastern University Sri Lanka (EUSL)" vs "Eastern University, Sri Lanka"
 *
 * So we bucket on post title + closing date (already a tight key), then merge
 * within a bucket only when the institutions plausibly refer to the same body.
 * That last check is what stops two unrelated "Driver" posts closing on the
 * same day — a very common pairing — from being silently merged into one.
 */
function dedupe(rows: Vacancy[]): Vacancy[] {
  const buckets = new Map<string, Vacancy[]>();

  for (const v of rows) {
    const key = `${normalizeForKey(v.title, 8)}|${v.closingDate ?? "none"}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(v);
    else buckets.set(key, [v]);
  }

  const out: Vacancy[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      out.push(bucket[0]);
      continue;
    }

    // Within a bucket, merge transitively across compatible institutions.
    const clusters: Vacancy[][] = [];
    for (const v of bucket) {
      const match = clusters.find((c) => c.some((other) => sameInstitution(v, other)));
      if (match) match.push(v);
      else clusters.push([v]);
    }

    for (const cluster of clusters) {
      // Keep the richest record in each cluster.
      out.push(cluster.reduce((best, v) => (score(v) > score(best) ? v : best)));
    }
  }

  return out;
}

/**
 * Region words that distinguish otherwise identically-worded bodies.
 *
 * Without this veto, "Central Provincial Council" and "Southern Provincial
 * Council" share two significant tokens ({provincial, council}) and would be
 * merged — collapsing two genuinely separate provincial recruitments that
 * routinely share a post title and a gazette closing date.
 */
const REGION_TOKENS = new Set([
  "central", "southern", "northern", "eastern", "western",
  "north", "south", "east", "west",
  "uva", "sabaragamuwa", "wayamba", "ruhuna",
]);

/** Do two institution strings plausibly name the same body? */
function sameInstitution(a: Vacancy, b: Vacancy): boolean {
  const ta = significantTokens(a.institution);
  const tb = significantTokens(b.institution);
  if (ta.size === 0 || tb.size === 0) return false;

  // If both name a region, they must name the *same* region. This also keeps
  // "North Central" distinct from "Central", since the sets differ.
  const ra = [...ta].filter((t) => REGION_TOKENS.has(t)).sort();
  const rb = [...tb].filter((t) => REGION_TOKENS.has(t)).sort();
  if (ra.length && rb.length && ra.join(" ") !== rb.join(" ")) return false;

  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;

  // One name fully contains the other ("… Public Service" vs "… Public
  // Service Commission"), or they share at least two meaningful words.
  const smaller = Math.min(ta.size, tb.size);
  if (shared === smaller) return true;
  return shared >= 2;
}

function significantTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 2 && !KEY_STOPWORDS.has(w)),
  );
}

/** Words that differ between the two sources without changing meaning. */
const KEY_STOPWORDS = new Set([
  "the", "of", "and", "for", "in", "at", "to", "a", "an",
  "sri", "lanka", "srilanka", "ltd", "limited", "pvt", "private",
]);

function normalizeForKey(text: string, wordLimit: number): string {
  return text
    .toLowerCase()
    // Drop "(EUSL)", "(OUSL)" style acronym suffixes.
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !KEY_STOPWORDS.has(w))
    .slice(0, wordLimit)
    .join(" ");
}

function score(v: Vacancy): number {
  let s = 0;
  if (v.closingDate) s += 4;
  if (v.institution && v.institution !== "Unknown") s += 2;
  if (v.category) s += 1;
  if (v.logoUrl) s += 1;
  return s;
}

/** Soonest deadline first; undated rows last; then alphabetical. */
function compareByUrgency(a: Vacancy, b: Vacancy): number {
  if (a.closingDate && b.closingDate) {
    if (a.closingDate !== b.closingDate) return a.closingDate < b.closingDate ? -1 : 1;
  } else if (a.closingDate) {
    return -1;
  } else if (b.closingDate) {
    return 1;
  }
  return a.institution.localeCompare(b.institution) || a.title.localeCompare(b.title);
}
