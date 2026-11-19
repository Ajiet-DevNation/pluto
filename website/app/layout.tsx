import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { site } from "@/content/site";
import { publicSiteUrl } from "@/lib/site-url";
import "./globals.css";

const instrument = localFont({
  src: "../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2",
  variable: "--font-sans",
  display: "swap",
});
const bricolage = localFont({
  src: "../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2",
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: publicSiteUrl ?? new URL("http://localhost:3000"),
  title: site.title,
  description: site.description,
  alternates: publicSiteUrl ? { canonical: "/" } : undefined,
  openGraph: {
    title: site.title,
    description: site.description,
    type: "website",
    images: [
      { url: "/og.png", width: 1200, height: 630, alt: "Pluto — DevNation's knowledge companion" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${instrument.variable} ${bricolage.variable}`}>
      <body>{children}</body>
    </html>
  );
}
