import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The cron endpoint triggers a crawl of the source sites; keep bots off it.
      disallow: ["/api/cron/"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
