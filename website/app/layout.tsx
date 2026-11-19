import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pluto — DevNation’s knowledge companion",
  description: "Pluto helps DevNation members find updates, meeting details, and project context from Discord, GitHub, and Miro.",
  openGraph: {
    title: "Pluto — DevNation’s knowledge companion",
    description: "Find DevNation updates, meeting details, and project context from Discord, GitHub, and Miro.",
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
