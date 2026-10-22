import type { Metadata, Viewport } from "next";
import { siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  // Lets relative URLs in link-preview tags resolve to absolute ones.
  metadataBase: new URL(siteUrl()),
  title: "Gazette Jobs — Live Sri Lankan government vacancies",
  description:
    "Every Sri Lankan government gazette vacancy whose application deadline has not yet passed, refreshed automatically every day.",
  openGraph: {
    title: "Gazette Jobs — Live Sri Lankan government vacancies",
    description: "Sri Lankan government vacancies with live application deadlines.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
