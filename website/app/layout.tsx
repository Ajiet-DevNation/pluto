import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pluto — DevNation’s knowledge companion",
  description: "Meet Pluto, DevNation’s read-only Discord knowledge assistant: indexed club records, deterministic activity digests, upcoming meetings and events, and an automatic meeting announcer.",
  openGraph: {
    title: "Pluto — DevNation’s knowledge companion",
    description: "Club knowledge from Discord, GitHub and Miro—indexed read-only, with activity digests, meeting reminders and event awareness.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body>{children}</body>
    </html>
  );
}
