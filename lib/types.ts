/** A single vacancy, normalised across every source. */
export interface Vacancy {
  /** Stable synthetic id: `${source}:${sourceId}`. Used for dedupe + upsert. */
  id: string;
  /** Which scraper produced this row. */
  source: SourceId;
  /** The source's own identifier (slug tail, query param, etc). */
  sourceId: string;
  /** English post title, e.g. "Management Assistant, Legal Officer". */
  title: string;
  /** Employing body, e.g. "Sri Lanka Ports Authority". */
  institution: string;
  /** ISO `YYYY-MM-DD`. Null when the source showed no parseable deadline. */
  closingDate: string | null;
  /** Link to the source's detail page. */
  url: string;
  /** Institution logo, when the source provides one. */
  logoUrl: string | null;
  /** Source-provided grouping, e.g. "Authority", "University". */
  category: string | null;
  /** True when the title/body indicates an open or limited competitive exam. */
  isExam: boolean;
  /** "open" | "limited" | null — parsed from the title where stated. */
  examStream: ExamStream;
  /** When this row was last seen by a scrape run (ISO timestamp). */
  scrapedAt: string;
}

export type SourceId = "governmentjobs" | "govdoc";
export type ExamStream = "open" | "limited" | null;

export interface ScrapeResult {
  source: SourceId;
  vacancies: Vacancy[];
  /** Non-fatal problems: a page that 404'd, a card we could not parse, etc. */
  warnings: string[];
  /** Set when the whole source failed; `vacancies` will be empty. */
  error?: string;
  durationMs: number;
}

export interface ScrapeReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: ScrapeResult[];
  /** Deduped, deadline-filtered rows that were persisted. */
  totalVacancies: number;
  /** Rows dropped because their deadline had already passed. */
  expiredDropped: number;
}
