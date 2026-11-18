import type { Metadata } from "next";
import styles from "./orbit.module.css";
import { OrbitShowcase } from "@/components/orbit-showcase";
import { CommandDemo } from "@/components/command-demo";
import { CommunityLinks } from "@/components/community-links";

export const metadata: Metadata = {
  title: "Pluto — DevNation's knowledge companion",
  description: "Meet Pluto, DevNation's read-only Discord knowledge assistant: indexed club records, deterministic activity digests, upcoming meetings and events, and an automatic meeting announcer.",
};

export default function OrbitPage() {
  return (
    <>
      <a className={styles.skip} href="#main">Skip to content</a>
      <OrbitShowcase />
      <header className={styles.masthead}>
        <a className={styles.brand} href="#meet" aria-label="Pluto home">
          <span className={styles.brandOrbit} aria-hidden="true" />Pluto<span className={styles.brandByline}> / by DevNation</span>
        </a>
        <nav className={styles.mastheadLinks} aria-label="Main links">
          <a href="https://github.com/Ajiet-DevNation/pluto">The code ↗</a>
          <a href="https://www.devnation.club/">DevNation ↗</a>
        </nav>
      </header>

      <main id="main">
        {/* Section 1: Introduction + Problem */}
        <section className={`${styles.stop} ${styles.hero}`} id="meet" data-orbit-stop aria-labelledby="meet-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}><span className={styles.mark}>✦</span>Read-only knowledge assistant</p>
            <h1 id="meet-title">Meet Pluto.<br />DevNation's<br /><em>knowledge companion.</em></h1>
            <p>Pluto brings together information from the club's Discord channels, public GitHub repositories, and Miro boards into one read-only record. It helps members stay informed about club activity, upcoming meetings, and events.</p>
            <p className={styles.note}>Not a general-purpose chatbot. Every output is grounded in indexed community records.</p>
            <div className={styles.buttonRow}>
              <a className={styles.pill} href="https://github.com/Ajiet-DevNation/pluto">Explore Pluto <span aria-hidden="true">↗</span></a>
              <a className={`${styles.pill} ${styles.secondary}`} href="#knowledge">See what Pluto knows <span aria-hidden="true">↓</span></a>
            </div>
            <a className={styles.scrollIndicator} href="#knowledge"><span aria-hidden="true">↓</span>See the problem Pluto solves.</a>
          </div>
        </section>

        {/* Section 2: Problem + Knowledge Indexing */}
        <section className={styles.stop} id="knowledge" data-orbit-stop aria-labelledby="knowledge-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>The problem Pluto solves</p>
            <h2 id="knowledge-title">Club knowledge is scattered.<br /><em>Pluto makes it findable.</em></h2>
            <p>Important information gets buried in Discord conversations. Project updates live across GitHub repositories. Meeting announcements are easy to miss. Pluto keeps an approved, read-only index of the places the club already works.</p>
            <div className={styles.featureLines}>
              <article><h3>Discord, on an allowlist.</h3><p>Five configured channels. New-message intake and startup backfill. Only explicitly allowed channels are indexed. Private channels, bot messages, and voice are excluded.</p></article>
              <article><h3>GitHub, public only.</h3><p>Public DevNation repositories. READMEs, issues, pull requests, commit messages, contributors, and eligible source files.</p></article>
              <article><h3>Miro, when configured.</h3><p>Read-only board items and connectors. Supported when a token and board access are configured. Shared workspace and live verification are pending.</p></article>
            </div>
            <p className={styles.fine}>Pluto never indexes private repositories, private channels, bot messages, or voice channels. Miro live verification is pending.</p>
          </div>
        </section>

        {/* Section 3: Activity Digest + Upcoming Meetings/Events */}
        <section className={styles.stop} id="journey" data-orbit-stop aria-labelledby="journey-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Everyday awareness</p>
            <h2 id="journey-title">Catch up.<br /><em>Stay ahead.</em></h2>
            <p>Pluto turns approved records into a few deterministic views. No AI-written narratives.</p>
            <ul className={styles.steps}>
              <li><div><h3>An honest activity snapshot.</h3><p><code>/digest</code> covers 1–30 days (default 7) and shows deterministic counts and links for GitHub issues, indexed Discord messages, a <code>#decisions</code> subset, and upcoming meetings and events. No AI summary. PRs and commits are not counted.</p></div></li>
              <li><div><h3>Meetings and events in one place.</h3><p><code>/upcoming meetings</code> lists confirmed future meetings. <code>/upcoming events</code> lists scheduled club events. Any member can add one with <code>/event add</code> and cancel by ID with <code>/event cancel</code>. Times use Asia/Kolkata and display in 12-hour IST.</p></div></li>
              <li><div><h3>A reminder before the meeting.</h3><p>The announcer watches only <code>#meeting-plans</code>. A human announcement with <code>@everyone</code> or <code>@here</code>, meeting language, and a clear future time becomes one durable reminder in <code>#pluto</code> one hour before. It never repeats the mass mention.</p></div></li>
            </ul>
            <span className={styles.note}>Meeting detection and reminders passed test-guild checks; production deployment acceptance is pending.</span>
          </div>
        </section>

        {/* Section 4: Commands + Announcer Details */}
        <section className={`${styles.stop} ${styles.scoreStop}`} id="how-it-works" data-orbit-stop aria-labelledby="how-title">
          <div className={`${styles.copy} ${styles.wideCopy}`}>
            <p className={styles.eyebrow}>Discord commands</p>
            <h2 id="how-title">Less digging.<br /><em>More doing.</em></h2>
            <p>Pick a command to see an illustrative reply. This preview doesn't connect to Discord.</p>
            <CommandDemo />
            <div className={styles.featureLines}>
              <article><h3>Automatic meeting announcer</h3><p>Monitors <code>#meeting-plans</code>. Requires a human author, an actual <code>@everyone</code>/<code>@here</code>, meeting language, and a parseable future time in Asia/Kolkata. Schedules a durable pg-boss reminder for one hour before. Posts only in <code>#pluto</code>. Never repeats the mass mention. Test-guild verified; production acceptance pending.</p></article>
              <article><h3>Command reference</h3><p><code>/digest [days]</code> — activity snapshot (1–30 days, default 7). <code>/upcoming meetings</code> — confirmed meetings. <code>/upcoming events</code> — scheduled events. <code>/event add</code> — any member adds an event. <code>/event cancel</code> — creator or Manage Events. <code>/optout</code> — exclude from indexing. <code>/help</code> — list commands.</p></article>
            </div>
          </div>
        </section>

        {/* Section 5: Privacy + Read-Only + How it Works */}
        <section className={styles.stop} id="built" data-orbit-stop aria-labelledby="built-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Privacy & read-only behaviour</p>
            <h2 id="built-title">Useful.<br /><em>Never intrusive.</em></h2>
            <p>Pluto does not modify the information it indexes.</p>
            <dl className={styles.featureLines}>
              <div><dt>Read-only external sources.</dt><dd>GET-only clients and read-only credentials. No GitHub writes, Discord history edits/deletions, or Miro writes. Posting new Discord messages is permitted.</dd></div>
              <div><dt>Selected channels. Public repositories.</dt><dd>Five-channel allowlist. <code>#pluto</code> and <code>#events</code> are never indexed. No private repos, private channels, bot messages, or voice recording.</dd></div>
              <div><dt>You can opt out.</dt><dd><code>/optout</code> excludes future indexing and removes existing indexed records. One-way in v1.</dd></div>
            </dl>
            <p className={styles.fine}><code>/ask</code> is not part of active v1. <code>/decisions</code> and transcript workflows are deferred. Pluto never cites its own output channel.</p>
            <p className={styles.eyebrow} style={{marginTop:'2rem'}}>How Pluto works</p>
            <ol className={styles.steps}>
              <li><div><h3>Collect.</h3><p>Approved information from Discord, GitHub, and configured Miro boards.</p></div></li>
              <li><div><h3>Index.</h3><p>Process and store searchable community knowledge.</p></div></li>
              <li><div><h3>Monitor & deliver.</h3><p>Watch meeting announcements, generate digests on demand, schedule reminders.</p></div></li>
            </ol>
          </div>
        </section>

        {/* Section 6: Examples + About DevNation */}
        <section className={`${styles.stop} ${styles.final}`} id="join" data-orbit-stop aria-labelledby="join-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Examples & about DevNation</p>
            <h2 id="join-title">See Pluto in action.<br /><em>Built at AJIET.</em></h2>
            <p>Pluto is an initiative developed by DevNation, the Student Development Club at AJIET. It organises shared knowledge, improves visibility into community activity, and makes meeting communication easier.</p>
            <dl className={styles.featureLines}>
              <article><h3>Illustrative examples</h3><p><code>/digest 7</code> → weekly activity snapshot with issue counts, message counts, decisions, upcoming meetings/events.<br /><code>/upcoming meetings</code> → confirmed meetings from announcer.<br /><code>/upcoming events</code> → scheduled club events.<br /><code>/event add</code> → event created with ephemeral confirmation and public <code>#events</code> record.<br /><code>/optout</code> → privacy exclusion explained.</p></article>
              <article><h3>Open source</h3><p>Pluto is built by student developers at AJIET. TypeScript, Node.js, Discord.js, Neon Postgres, pg-boss, Cloudflare Workers AI. The code is open source.</p></article>
            </dl>
            <div className={styles.stackline} aria-label="Technology stack"><span>TypeScript</span><span>Node.js 22</span><span>Discord.js</span><span>Neon Postgres</span><span>pgvector</span><span>Drizzle</span><span>pg-boss</span><span>Cloudflare Workers AI</span><span>GitHub App</span><span>Miro REST v2</span></div>
            <div className={styles.buttonRow}>
              <a className={styles.pill} href="https://www.devnation.club/">DevNation ↗</a>
              <a className={`${styles.pill} ${styles.secondary}`} href="https://github.com/Ajiet-DevNation/pluto">Pluto on GitHub ↗</a>
            </div>
            <footer className={styles.footer}>An open-source project by DevNation at AJIET. <a href="https://github.com/Ajiet-DevNation/pluto">Explore the repository ↗</a></footer>
          </div>
        </section>
      </main>
    </>
  );
}
