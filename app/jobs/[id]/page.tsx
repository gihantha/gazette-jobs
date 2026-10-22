import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBoard } from "@/lib/vacancies";
import { daysUntil, formatDisplayDate } from "@/lib/dates";
import { jobPath } from "@/lib/site";
import type { Vacancy } from "@/lib/types";
import { Countdown } from "../../Countdown";
import { JobActions } from "../../JobActions";

// Same cache window as the board; a cold refresh re-scrapes, so allow the time.
export const revalidate = 1800;
export const maxDuration = 60;

async function findJob(id: string): Promise<{ job: Vacancy; today: string } | null> {
  const board = await getBoard();
  const job = board.vacancies.find((v) => v.id === id);
  return job ? { job, today: board.today } : null;
}

function describe(job: Vacancy, today: string): string {
  if (!job.closingDate) return `${job.title} at ${job.institution}. No closing date published — check the notice.`;
  const left = daysUntil(job.closingDate, today);
  const when =
    left <= 0 ? "close today" : left === 1 ? "close tomorrow" : `close ${formatDisplayDate(job.closingDate)}`;
  return `${job.title} at ${job.institution} — applications ${when}.`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const found = await findJob(decodeURIComponent(id));
  if (!found) return { title: "Vacancy closed or not found — Gazette Jobs", robots: { index: false } };

  const { job, today } = found;
  const title = `${job.title} — ${job.institution}`;
  const description = describe(job, today);

  return {
    title: `${title} | Gazette Jobs`,
    description,
    alternates: { canonical: jobPath(job.id) },
    openGraph: { title, description, type: "article", url: jobPath(job.id) },
  };
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await findJob(decodeURIComponent(id));
  if (!found) notFound();

  const { job, today } = found;

  return (
    <main className="shell">
      <p className="crumb">
        <Link href="/">← All vacancies</Link>
      </p>

      <article className="detail">
        <h1>{job.title}</h1>
        <p className="detail-inst">{job.institution}</p>

        <div className="detail-meta">
          {job.examStream === "open" && <span className="chip open">Open exam</span>}
          {job.examStream === "limited" && <span className="chip limited">Limited</span>}
          {job.applyUrl && <span className="chip apply">Apply online</span>}
          {job.category && <span className="chip limited">{job.category}</span>}
        </div>

        <dl className="detail-facts">
          <div>
            <dt>Closing date</dt>
            <dd>
              {job.closingDate ? formatDisplayDate(job.closingDate) : "No date published"}{" "}
              <Countdown closingDate={job.closingDate} today={today} />
            </dd>
          </div>
        </dl>

        <div className="detail-buttons">
          {job.applyUrl && (
            <a className="btn primary" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
              Apply online
            </a>
          )}
          <a className="btn" href={job.url} target="_blank" rel="noopener noreferrer">
            View original notice
          </a>
          <JobActions vacancy={job} />
        </div>

        <p className="detail-note">
          Listed from a third-party aggregator, not the official gazette. Confirm the closing date,
          eligibility and how to apply in the notice before applying
          {job.applyUrl ? "" : " — no online application link was found for this post"}. Some
          deadlines are registered-post dates, meaning the application must arrive by then.
        </p>
      </article>
    </main>
  );
}
