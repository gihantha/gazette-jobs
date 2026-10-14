/**
 * Source: job.govdoc.lk
 *
 * Structure (verified 2026-10-15):
 *   .single-job-card
 *     a[href="https://job.govdoc.lk/<slug>-<id>"]
 *     .image img[src]                 -> institution logo
 *     .title .title-sin h4            -> ENGLISH title  (yes, really)
 *     .title .title-eng h4            -> Sinhala title, mojibake
 *     .closing-date p                 -> "Closing Date : 2026-10-18"
 *     .tag-wrp p:nth-of-type(1)       -> institution, already clean
 *     .tag-wrp p:nth-of-type(2)       -> category, e.g. "Authority"
 *
 * The `title-sin` / `title-eng` class names are swapped on this site, so we
 * never trust them — we pick whichever of the two is more ASCII-heavy.
 *
 * 16 cards per page via `?page=N`, with no pagination links in the HTML (the
 * site paginates client-side), so we walk pages until one yields no new ids.
 */
import * as cheerio from "cheerio";
import type { ScrapeResult, Vacancy } from "../../types";
import { isStillOpen, parseClosingDate, todayInColombo } from "../../dates";
import { asciiRatio, fetchText } from "../http";
import { classifyExam } from "../normalize";

const BASE = "https://job.govdoc.lk/";

/**
 * Hard ceiling on pages walked, so a pagination bug on their side cannot make
 * us crawl forever. 16 cards per page.
 */
const MAX_PAGES = 40;

/**
 * Listings come back newest-posted first, and deadlines broadly track posting
 * date, so once we have seen this many consecutive pages containing nothing
 * still open we can safely stop. Two pages (32 cards) of slack means a handful
 * of stale rows interleaved among live ones will not cut the walk short.
 */
const MAX_BARREN_PAGES = 2;

export async function scrapeGovdoc(): Promise<ScrapeResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const byId = new Map<string, Vacancy>();
  const scrapedAt = new Date().toISOString();
  const today = todayInColombo();
  let fatal: string | undefined;
  let barrenPages = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? BASE : `${BASE}?page=${page}`;

    let html: string;
    try {
      html = await fetchText(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (page === 1) {
        fatal = message;
      } else {
        // Partial data is still useful; note it and stop walking.
        warnings.push(`page ${page}: ${message}`);
      }
      break;
    }

    const $ = cheerio.load(html);
    const cards = $(".single-job-card");

    if (cards.length === 0) {
      if (page === 1) {
        fatal = "no `.single-job-card` elements found — markup has probably changed";
      }
      break;
    }

    let newOnThisPage = 0;
    let liveOnThisPage = 0;

    cards.each((index, el) => {
      const card = $(el);
      const href = card.find("a").first().attr("href") ?? "";

      // Trailing numeric segment of the slug is the site's own job id.
      const slug = href.replace(/\/+$/, "").split("/").pop() ?? "";
      const idMatch = slug.match(/-(\d+)$/);
      const sourceId = idMatch ? idMatch[1] : slug || `p${page}-i${index}`;
      if (!idMatch) {
        warnings.push(`page ${page} card ${index}: no numeric id in "${slug}", using fallback`);
      }

      const id = `govdoc:${sourceId}`;
      if (byId.has(id)) return;

      // Pick the more ASCII-heavy of the two title nodes.
      const candidates = card
        .find(".title h4")
        .map((_, h) => $(h).text().replace(/\s+/g, " ").trim())
        .get()
        .filter(Boolean);

      const title = candidates.sort((a, b) => asciiRatio(b) - asciiRatio(a))[0] ?? "";
      if (!title) {
        warnings.push(`page ${page} card ${index}: no title`);
        return;
      }

      const rawDate =
        card.find(".closing-date p").first().text() ||
        card.find(".closing-date span").last().text();
      const closingDate = parseClosingDate(rawDate);
      if (!closingDate && rawDate.trim()) {
        warnings.push(
          `"${title.slice(0, 60)}": unparseable date ${JSON.stringify(rawDate.trim())}`,
        );
      }

      const tags = card
        .find(".tag-wrp p")
        .map((_, p) => $(p).text().replace(/\s+/g, " ").trim())
        .get()
        .filter(Boolean);

      // This source gives us the institution as its own field, so unlike
      // governmentjobs.lk we do not have to split it back out of the title.
      const institution = tags[0] ?? "Unknown";
      const category = tags[1] ?? null;

      const logo = card.find(".image img").first().attr("src") ?? null;
      const { isExam, examStream } = classifyExam(title);

      byId.set(id, {
        id,
        source: "govdoc",
        sourceId,
        // Strip the trailing " - <institution>" the title usually repeats.
        title: stripInstitutionSuffix(title, institution),
        institution,
        closingDate,
        url: href ? new URL(href, BASE).toString() : BASE,
        logoUrl: logo ? new URL(logo, BASE).toString() : null,
        category,
        isExam,
        examStream,
        scrapedAt,
      });

      newOnThisPage++;
      if (isStillOpen(closingDate, today)) liveOnThisPage++;
    });

    // Site looped back to earlier results, or we reached the end.
    if (newOnThisPage === 0) break;

    barrenPages = liveOnThisPage === 0 ? barrenPages + 1 : 0;
    if (barrenPages >= MAX_BARREN_PAGES) break;
  }

  if (fatal) {
    return {
      source: "govdoc",
      vacancies: [],
      warnings,
      error: fatal,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    source: "govdoc",
    vacancies: [...byId.values()],
    warnings,
    durationMs: Date.now() - startedAt,
  };
}

/** "Receptionist - Lake House" + "…Lake House" -> "Receptionist". */
function stripInstitutionSuffix(title: string, institution: string): string {
  const idx = title.lastIndexOf(" - ");
  if (idx <= 0) return title;

  const tail = title.slice(idx + 3).trim().toLowerCase();
  const inst = institution.toLowerCase();
  // Only strip when the tail really is the institution, not a meaningful part
  // of the post name (e.g. "Engineer - Civil").
  if (inst.includes(tail) || tail.includes(inst.slice(0, 20))) {
    return title.slice(0, idx).trim();
  }
  return title;
}
