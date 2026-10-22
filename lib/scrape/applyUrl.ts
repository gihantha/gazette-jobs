/**
 * Pull the "Apply" button target out of a job.govdoc.lk detail page.
 *
 * Only the detail page carries it — the listing cards do not — and only some
 * jobs have one (about 3 in 10 when sampled). A page with no such link says
 * nothing about *how* to apply (post, email, in person), so callers must treat
 * `null` as "unknown", never as "by post".
 */
import * as cheerio from "cheerio";

const APPLY_LABEL = /^apply( now| online| here)?$/i;

export function extractApplyUrl(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html);
  const pageHost = new URL(pageUrl).host;

  for (const a of $("a[href]").toArray()) {
    const text = $(a).text().replace(/\s+/g, " ").trim();
    if (!APPLY_LABEL.test(text)) continue;

    try {
      const target = new URL($(a).attr("href") ?? "", pageUrl);
      const isWeb = target.protocol === "http:" || target.protocol === "https:";
      // An "Apply" link back into the same site is navigation, not an application form.
      if (isWeb && target.host !== pageHost) return target.toString();
    } catch {
      // Malformed href — keep looking.
    }
  }
  return null;
}
