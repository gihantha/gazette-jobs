"use client";

import { useMemo, useState } from "react";
import type { Vacancy } from "@/lib/types";
import { daysUntil, formatDisplayDate } from "@/lib/dates";

type ExamFilter = "all" | "any" | "open" | "limited";
type WindowFilter = 0 | 3 | 7 | 30;

interface Props {
  vacancies: Vacancy[];
  today: string;
  lastUpdated: string | null;
  mode: "database" | "live-scrape";
  degraded: boolean;
}

export function JobBoard({ vacancies, today, lastUpdated, mode, degraded }: Props) {
  const [query, setQuery] = useState("");
  const [exam, setExam] = useState<ExamFilter>("all");
  const [win, setWin] = useState<WindowFilter>(0);

  const stats = useMemo(() => {
    const dated = vacancies.filter((v) => v.closingDate);
    return {
      total: vacancies.length,
      within7: dated.filter((v) => daysUntil(v.closingDate!, today) <= 7).length,
      openExams: vacancies.filter((v) => v.examStream === "open").length,
      institutions: new Set(vacancies.map((v) => v.institution)).size,
    };
  }, [vacancies, today]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vacancies.filter((v) => {
      if (exam === "any" && !v.isExam) return false;
      if (exam === "open" && v.examStream !== "open") return false;
      if (exam === "limited" && v.examStream !== "limited") return false;

      if (win > 0) {
        if (!v.closingDate) return false;
        if (daysUntil(v.closingDate, today) > win) return false;
      }

      if (q) {
        const haystack = `${v.title} ${v.institution} ${v.category ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [vacancies, query, exam, win, today]);

  const groups = useMemo(() => groupByUrgency(filtered, today), [filtered, today]);

  return (
    <>
      <header className="masthead">
        <div>
          <h1>Sri Lanka Gazette Jobs</h1>
          <p>Government vacancies whose application deadline has not yet passed.</p>
        </div>
        <div className="meta">
          <div>
            Today in Colombo: <strong>{formatDisplayDate(today)}</strong>
          </div>
          <div>
            {lastUpdated ? (
              <>
                Data refreshed: <strong>{formatTimestamp(lastUpdated)}</strong>
              </>
            ) : (
              "Awaiting first refresh"
            )}
          </div>
        </div>
      </header>

      {degraded && (
        <div className="banner">
          Serving a live scrape because the database was unreachable or still empty.
          Data is correct but the page may be slower than usual.
        </div>
      )}

      <section className="tiles">
        <div className="tile">
          <div className="n">{stats.total}</div>
          <div className="l">Open vacancies</div>
        </div>
        <div className="tile is-urgent">
          <div className="n">{stats.within7}</div>
          <div className="l">Closing within 7 days</div>
        </div>
        <div className="tile is-exam">
          <div className="n">{stats.openExams}</div>
          <div className="l">Open competitive exams</div>
        </div>
        <div className="tile">
          <div className="n">{stats.institutions}</div>
          <div className="l">Institutions hiring</div>
        </div>
      </section>

      <div className="controls">
        <div className="search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search post or institution — e.g. driver, customs, university"
            aria-label="Search vacancies"
          />
        </div>

        <div className="segmented" role="group" aria-label="Filter by type">
          {(
            [
              ["all", "All"],
              ["any", "Exams"],
              ["open", "Open exams"],
              ["limited", "Limited"],
            ] as [ExamFilter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={exam === value}
              onClick={() => setExam(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="segmented" role="group" aria-label="Filter by deadline">
          {(
            [
              [0, "Any date"],
              [3, "≤ 3 days"],
              [7, "≤ 7 days"],
              [30, "≤ 30 days"],
            ] as [WindowFilter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={win === value}
              onClick={() => setWin(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          No vacancies match those filters.
          {query && " Try a shorter search term."}
        </div>
      ) : (
        groups.map((g) => (
          <section className={`group ${g.tone}`} key={g.label}>
            <div className="group-head">
              <h2>{g.label}</h2>
              <span>
                {g.items.length} {g.items.length === 1 ? "post" : "posts"}
              </span>
            </div>
            <div className="rows">
              {g.items.map((v) => (
                <a
                  className="row"
                  key={v.id}
                  href={v.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="row-main">
                    <span className="row-title">{v.title}</span>
                    <div className="row-sub">
                      <span>{v.institution}</span>
                      {v.examStream === "open" && <span className="chip open">Open exam</span>}
                      {v.examStream === "limited" && (
                        <span className="chip limited">Limited</span>
                      )}
                    </div>
                  </div>
                  <div className="row-side">
                    <div className="date">
                      {v.closingDate ? formatDisplayDate(v.closingDate) : "No date published"}
                    </div>
                    <div>
                      <Countdown closingDate={v.closingDate} today={today} />
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        ))
      )}

      <footer className="site">
        <p>
          Showing {filtered.length} of {vacancies.length} open posts, aggregated from{" "}
          <a href="https://governmentjobs.lk/" target="_blank" rel="noopener noreferrer">
            governmentjobs.lk
          </a>{" "}
          and{" "}
          <a href="https://job.govdoc.lk/" target="_blank" rel="noopener noreferrer">
            job.govdoc.lk
          </a>
          . Refreshed automatically three times a day
          {mode === "live-scrape" ? " (currently served live)" : ""}.
        </p>
        <p>
          These are third-party aggregators, not the official gazette. Always confirm the
          closing date and eligibility against the gazette notice itself at{" "}
          <a href="http://www.documents.gov.lk/en/gazette.php" target="_blank" rel="noopener noreferrer">
            documents.gov.lk
          </a>{" "}
          before applying. Some deadlines are registered-post dates, meaning the application
          must physically arrive by then.
        </p>
      </footer>
    </>
  );
}

function Countdown({ closingDate, today }: { closingDate: string | null; today: string }) {
  if (!closingDate) return <span className="countdown none">Check source</span>;

  const d = daysUntil(closingDate, today);
  if (d <= 0) return <span className="countdown urgent">Closes today</span>;
  if (d === 1) return <span className="countdown urgent">1 day left</span>;
  if (d <= 3) return <span className="countdown urgent">{d} days left</span>;
  if (d <= 7) return <span className="countdown soon">{d} days left</span>;
  return <span className="countdown ok">{d} days left</span>;
}

interface Group {
  label: string;
  tone: "urgent" | "soon" | "later";
  items: Vacancy[];
}

/** Bucket by how much time is left, so the board reads as a to-do list. */
function groupByUrgency(rows: Vacancy[], today: string): Group[] {
  const buckets: Group[] = [
    { label: "Closing today or tomorrow", tone: "urgent", items: [] },
    { label: "This week", tone: "soon", items: [] },
    { label: "Later this month", tone: "later", items: [] },
    { label: "Beyond a month", tone: "later", items: [] },
    { label: "No deadline published", tone: "later", items: [] },
  ];

  for (const v of rows) {
    if (!v.closingDate) {
      buckets[4].items.push(v);
      continue;
    }
    const d = daysUntil(v.closingDate, today);
    if (d <= 1) buckets[0].items.push(v);
    else if (d <= 7) buckets[1].items.push(v);
    else if (d <= 30) buckets[2].items.push(v);
    else buckets[3].items.push(v);
  }

  return buckets.filter((b) => b.items.length > 0);
}

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
