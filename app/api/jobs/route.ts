/**
 * Public JSON API.
 *
 *   GET /api/jobs
 *   GET /api/jobs?exam=open          only open-stream competitive exams
 *   GET /api/jobs?exam=limited       only limited/departmental exams
 *   GET /api/jobs?exam=any           anything flagged as a competitive exam
 *   GET /api/jobs?apply=online       only posts with a direct application link
 *   GET /api/jobs?within=7          closing within the next 7 days
 *   GET /api/jobs?q=customs          substring match on post or institution
 *
 * Only vacancies still open in Asia/Colombo are ever returned.
 */
import { NextResponse } from "next/server";
import { getBoard } from "@/lib/vacancies";
import { daysUntil } from "@/lib/dates";

export const revalidate = 1800;
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const board = await getBoard();

  let rows = board.vacancies;

  const exam = searchParams.get("exam");
  if (exam === "open") rows = rows.filter((v) => v.examStream === "open");
  else if (exam === "limited") rows = rows.filter((v) => v.examStream === "limited");
  else if (exam === "any") rows = rows.filter((v) => v.isExam);

  if (searchParams.get("apply") === "online") rows = rows.filter((v) => v.applyUrl);

  const within = Number(searchParams.get("within"));
  if (Number.isFinite(within) && within > 0) {
    rows = rows.filter(
      (v) => v.closingDate !== null && daysUntil(v.closingDate, board.today) <= within,
    );
  }

  const q = searchParams.get("q")?.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (v) =>
        v.title.toLowerCase().includes(q) || v.institution.toLowerCase().includes(q),
    );
  }

  return NextResponse.json({
    today: board.today,
    lastUpdated: board.lastUpdated,
    mode: board.mode,
    count: rows.length,
    vacancies: rows,
  });
}
