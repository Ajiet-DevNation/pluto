import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pluto — DevNation’s Discord companion",
  description: "Meet Pluto, DevNation’s Discord bot for community activity, events and meeting reminders. Built by DevNation at AJIET.",
  openGraph: {
    title: "Pluto — DevNation’s Discord companion",
    description: "Project activity, upcoming events and meeting reminders, right where DevNation talks.",
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
