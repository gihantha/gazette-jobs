/**
 * Absolute site URL, needed for the sitemap and link-preview tags (WhatsApp and
 * Google ignore relative URLs there).
 *
 * Set NEXT_PUBLIC_SITE_URL once a custom domain exists. Until then Vercel's own
 * production hostname is used; it is injected without a protocol.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

/**
 * Path of a vacancy's own page. Ids contain `:` and, for governmentjobs.lk,
 * base64 padding (`=`), so they must be encoded.
 */
export function jobPath(id: string): string {
  return `/jobs/${encodeURIComponent(id)}`;
}
