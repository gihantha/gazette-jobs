/**
 * Build an .ics calendar file for a vacancy's application deadline.
 *
 * The event is all-day on the closing date (a plain calendar date, so no
 * timezone can shift it) with a reminder the day before. Vacancies without a
 * deadline have nothing to put in a calendar, so callers must check first.
 */
import type { Vacancy } from "./types";

/** Escape text per RFC 5545 section 3.3.11. */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold lines longer than 75 octets, as the spec requires. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  // Continuation lines start with a space, which counts toward their 75 octets.
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compactDate = (iso: string) => iso.replace(/-/g, "");

/** The calendar day after `iso`, as `YYYYMMDD` (an all-day event ends exclusive). */
function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function buildIcs(v: Vacancy, now: Date = new Date()): string | null {
  if (!v.closingDate) return null;

  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const description = [
    `${v.title} at ${v.institution}.`,
    `Applications close on this date. Confirm the closing date and how to apply in the gazette notice.`,
    v.applyUrl ? `Apply online: ${v.applyUrl}` : null,
    `Details: ${v.url}`,
  ]
    .filter(Boolean)
    .join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gazette Jobs//Deadline//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${v.id.replace(/[^A-Za-z0-9._-]/g, "_")}@gazette-jobs`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDate(v.closingDate)}`,
    `DTEND;VALUE=DATE:${nextDay(v.closingDate)}`,
    `SUMMARY:${escapeText(`Closing: ${v.title} (${v.institution})`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${v.url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(`Applications close tomorrow: ${v.title}`)}`,
    "TRIGGER:-P1D",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(fold).join("\r\n") + "\r\n";
}
