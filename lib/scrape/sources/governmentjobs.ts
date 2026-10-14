/**
 * Source: governmentjobs.lk
 *
 * Structure (verified 2026-10-15):
 *   div.grid-view.product
 *     .product-info h5 a            -> title (listed twice; the second carries
 *                                      class="sinhala" and is mojibake)
 *       href="vacancy_details.php?aid=<opaque>"
 *     .product-image img[src]       -> institution logo
 *     span.price                    -> "Closing Date: 2026-10-16"
 *
 * `index.php?ipp=All` returns every live vacancy in a single response, which is
 * both cheaper for them and simpler for us than walking pagination.
 */
import * as cheerio from "cheerio";
import type { ScrapeResult, Vacancy } from "../../types";
import { parseClosingDate } from "../../dates";
import { asciiRatio, fetchText } from "../http";
import { classifyExam, splitTitleAndInstitution } from "../normalize";

const BASE = "https://governmentjobs.lk/";
const LIST_URL = `${BASE}index.php?page=1&ipp=All&`;

export async function scrapeGovernmentJobs(): Promise<ScrapeResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const vacancies: Vacancy[] = [];
  const scrapedAt = new Date().toISOString();

  let html: string;
  try {
    html = await fetchText(LIST_URL);
  } catch (err) {
    return {
      source: "governmentjobs",
      vacancies: [],
      warnings,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }

  const $ = cheerio.load(html);
  const cards = $("div.grid-view.product");

  if (cards.length === 0) {
    return {
      source: "governmentjobs",
      vacancies: [],
      warnings,
      error:
        "no `div.grid-view.product` cards found — the site's markup has probably changed",
      durationMs: Date.now() - startedAt,
    };
  }

  cards.each((index, el) => {
    const card = $(el);

    // Of the (usually two) title anchors, keep the most ASCII-heavy one.
    let title = "";
    let href = "";
    let bestRatio = -1;

    card.find(".product-info h5 a").each((_, a) => {
      const anchor = $(a);
      const text = anchor.text().replace(/\s+/g, " ").trim();
      if (!text) return;
      const ratio = asciiRatio(text);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        title = text;
        href = anchor.attr("href") ?? href;
      }
      // Keep the first href even if the English title won on a later anchor.
      if (!href) href = anchor.attr("href") ?? "";
    });

    if (!title) {
      warnings.push(`card ${index}: no title anchor`);
      return;
    }

    const rawDate = card.find("span.price").first().text();
    const closingDate = parseClosingDate(rawDate);
    if (!closingDate && rawDate.trim()) {
      warnings.push(`"${title.slice(0, 60)}": unparseable date ${JSON.stringify(rawDate.trim())}`);
    }

    // The `aid` query param is the site's own stable identifier.
    const aid = href.match(/aid=([^&]+)/)?.[1];
    const sourceId = aid ? decodeURIComponent(aid) : `idx-${index}-${title.slice(0, 40)}`;
    if (!aid) warnings.push(`"${title.slice(0, 60)}": no aid in href, using positional id`);

    const logo = card.find(".product-image img").first().attr("src") ?? null;
    const { post, institution } = splitTitleAndInstitution(title);
    const { isExam, examStream } = classifyExam(title);

    vacancies.push({
      id: `governmentjobs:${sourceId}`,
      source: "governmentjobs",
      sourceId,
      title: post,
      institution,
      closingDate,
      url: href ? new URL(href, BASE).toString() : LIST_URL,
      logoUrl: logo ? new URL(logo, BASE).toString() : null,
      category: null,
      isExam,
      examStream,
      scrapedAt,
    });
  });

  return {
    source: "governmentjobs",
    vacancies,
    warnings,
    durationMs: Date.now() - startedAt,
  };
}
