"use client";

import { useState } from "react";
import type { Vacancy } from "@/lib/types";
import { buildIcs } from "@/lib/calendar";
import { jobPath } from "@/lib/site";
import { useSavedJobs } from "./useSavedJobs";

/** Hand the browser an .ics file; the calendar app takes it from there. */
export function downloadIcs(v: Vacancy): void {
  const ics = buildIcs(v);
  if (!ics) return;

  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${v.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50) || "deadline"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Save, calendar and share buttons for the vacancy's own page. */
export function JobActions({ vacancy }: { vacancy: Vacancy }) {
  const { saved, toggle } = useSavedJobs();
  const isSaved = saved.has(vacancy.id);

  return (
    <>
      <button type="button" className="btn" onClick={() => toggle(vacancy.id)} aria-pressed={isSaved}>
        {isSaved ? "★ Saved" : "☆ Save"}
      </button>
      {vacancy.closingDate && (
        <button type="button" className="btn" onClick={() => downloadIcs(vacancy)}>
          📅 Add to calendar
        </button>
      )}
      <ShareButton vacancy={vacancy} className="btn" />
    </>
  );
}

/**
 * Share a vacancy's own page. Uses the phone's share sheet when there is one
 * (WhatsApp, Telegram, ...) and copies the link otherwise.
 */
export function ShareButton({ vacancy, className = "action" }: { vacancy: Vacancy; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}${jobPath(vacancy.id)}`;
    const text = `${vacancy.title} — ${vacancy.institution}`;

    try {
      if (navigator.share) {
        await navigator.share({ title: text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // The user dismissed the share sheet, or clipboard access was denied.
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={share}
      aria-label={`Share ${vacancy.title}`}
      title="Share this post"
    >
      {copied ? "Link copied" : className === "btn" ? "🔗 Share" : "🔗"}
    </button>
  );
}
