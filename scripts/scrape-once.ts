/**
 * Run the scrapers once from the command line and print a summary.
 *
 *   npm run scrape            # print a report, do not touch the database
 *   npm run scrape -- --save  # also upsert into the database
 *   npm run scrape -- --json  # dump the full vacancy array as JSON
 */
import { scrapeAll } from "../lib/scrape";
import { daysUntil, todayInColombo } from "../lib/dates";

async function main() {
  const save = process.argv.includes("--save");
  const asJson = process.argv.includes("--json");

  const { report, vacancies } = await scrapeAll();

  if (asJson) {
    console.log(JSON.stringify(vacancies, null, 2));
    return;
  }

  const today = todayInColombo();
  console.log(`\nToday in Colombo: ${today}`);
  console.log(`Scrape took ${report.durationMs} ms\n`);

  for (const r of report.results) {
    const status = r.error ? `FAILED - ${r.error}` : `${r.vacancies.length} rows`;
    console.log(`  ${r.source.padEnd(16)} ${String(r.durationMs).padStart(6)} ms  ${status}`);
    for (const w of r.warnings.slice(0, 5)) console.log(`      warn: ${w}`);
    if (r.warnings.length > 5) console.log(`      ... and ${r.warnings.length - 5} more warnings`);
  }

  console.log(
    `\nLive vacancies: ${report.totalVacancies}   (dropped ${report.expiredDropped} expired)\n`,
  );

  const exams = vacancies.filter((v) => v.isExam);
  console.log(`Competitive exams among them: ${exams.length}`);
  console.log(`  open stream:    ${exams.filter((v) => v.examStream === "open").length}`);
  console.log(`  limited stream: ${exams.filter((v) => v.examStream === "limited").length}\n`);

  console.log("Soonest 25 deadlines:");
  for (const v of vacancies.slice(0, 25)) {
    const d = v.closingDate ? `${v.closingDate} (${daysUntil(v.closingDate, today)}d)` : "no date";
    const tag = v.examStream ? ` [${v.examStream}]` : v.isExam ? " [exam]" : "";
    console.log(`  ${d.padEnd(20)} ${v.title.slice(0, 54).padEnd(56)} ${v.institution.slice(0, 40)}${tag}`);
  }

  if (save) {
    const { upsertVacancies, recordScrapeRun } = await import("../lib/db");
    const written = await upsertVacancies(vacancies);
    await recordScrapeRun(report);
    console.log(`\nSaved ${written} rows to the database.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
