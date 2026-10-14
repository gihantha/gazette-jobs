import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gazette Jobs — Live Sri Lankan government vacancies",
  description:
    "Every Sri Lankan government gazette vacancy whose application deadline has not yet passed, refreshed automatically three times a day.",
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
