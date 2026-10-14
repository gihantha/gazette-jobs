/**
 * Date helpers.
 *
 * Everything here is anchored to Asia/Colombo (UTC+05:30). This matters: the
 * app is deployed on Vercel, whose functions run in UTC. A vacancy closing
 * "2026-10-15" is open for all of the 15th *in Sri Lanka*, which is still the
 * 14th for ~5.5 hours of UTC — and, worse, 19:00 UTC on the 15th is already the
 * 16th in Colombo. Computing "is this expired?" against a UTC clock therefore
 * drops listings while they are still live, and keeps others a day too long.
 */

const COLOMBO_TZ = "Asia/Colombo";

/** Today's date in Colombo, as `YYYY-MM-DD`. */
export function todayInColombo(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is what we want to compare as strings.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: COLOMBO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * True when `closingDate` is today or later in Colombo.
 *
 * A null deadline counts as still-open: the source did not publish one, and
 * silently hiding those would lose real vacancies. The UI flags them instead.
 */
export function isStillOpen(closingDate: string | null, today = todayInColombo()): boolean {
  if (!closingDate) return true;
  return closingDate >= today;
}

/** Whole days from today (Colombo) until the deadline. Negative once past. */
export function daysUntil(closingDate: string, today = todayInColombo()): number {
  const MS_PER_DAY = 86_400_000;
  // Both are plain calendar dates, so parsing them as UTC midnight is exact and
  // sidesteps DST entirely (Sri Lanka has no DST, but this stays correct anyway).
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${closingDate}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Parse the date formats these gazette sites actually use, and return
 * `YYYY-MM-DD` (or null).
 *
 * Observed in the wild:
 *   "Closing Date: 2026-10-16"      governmentjobs.lk
 *   "Closing Date : 2026-10-18" job.govdoc.lk (nbsp after the colon)
 *   "2026.11.12"                    gazette amendment notices
 *   "12 November 2026" / "12 Nov 2026"
 *   "November 12, 2026"
 *   "12/11/2026"                    day-first, per local convention
 */
export function parseClosingDate(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Normalise nbsp and collapse whitespace before anything else.
  const text = raw.replace(/ /g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  // 2026-10-16 or 2026.10.16 or 2026/10/16
  const iso = text.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (iso) return build(+iso[1], +iso[2], +iso[3]);

  // 12 November 2026 / 12 Nov 2026 / 12th November 2026
  const dmy = text.match(/\b(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9}),? (20\d{2})\b/);
  if (dmy) {
    const m = MONTHS[dmy[2].toLowerCase()];
    if (m) return build(+dmy[3], m, +dmy[1]);
  }

  // November 12, 2026 / Nov 12 2026
  const mdy = text.match(/\b([A-Za-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?,? (20\d{2})\b/);
  if (mdy) {
    const m = MONTHS[mdy[1].toLowerCase()];
    if (m) return build(+mdy[3], m, +mdy[2]);
  }

  // 12/11/2026 — day-first, which is the Sri Lankan convention.
  const slash = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/);
  if (slash) return build(+slash[3], +slash[2], +slash[1]);

  return null;
}

function build(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject impossible days (e.g. 31 February) by round-tripping through Date.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "Mon, 16 Oct 2026" for display. */
export function formatDisplayDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}
