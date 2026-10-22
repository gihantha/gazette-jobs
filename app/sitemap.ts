import type { MetadataRoute } from "next";
import { getBoard } from "@/lib/vacancies";
import { jobPath, siteUrl } from "@/lib/site";

export const revalidate = 3600;
export const maxDuration = 60;

/**
 * Every open vacancy, so search engines can find individual posts. Closed posts
 * drop out on their own, since the board only ever holds open ones.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const board = await getBoard();
  const modified = board.lastUpdated ? new Date(board.lastUpdated) : new Date();

  return [
    { url: base, lastModified: modified, changeFrequency: "daily", priority: 1 },
    ...board.vacancies.map((v) => ({
      url: `${base}${jobPath(v.id)}`,
      lastModified: modified,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];
}
