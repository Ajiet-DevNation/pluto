import { OrbitExperience } from "@/components/orbit-experience";
import { CommandDemo } from "@/components/command-demo";
import { CommunityLinks } from "@/components/community-links";

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <a className="wordmark" href="#meet" aria-label="Pluto home"><span className="brand-orbit" aria-hidden="true" />Pluto<span className="brand-byline"> / by DevNation</span></a>
        <a className="community-link" href="https://www.devnation.club/">devnation.club <span aria-hidden="true">↗</span></a>
      </header>
      <OrbitExperience />
      <main id="main">
        <section className="orbit-stop" id="meet" aria-labelledby="meet-title">
          <div className="story-copy">
            <p className="eyebrow"><span className="status-light" /> Read-only knowledge assistant</p>
            <h1 id="meet-title">Meet Pluto,<br />DevNation’s<br /><em>knowledge companion.</em></h1>
            <p>Pluto brings the club’s Discord channels, public GitHub work and Miro boards into one read-only record—then helps members catch up and stay ahead. It is not a general-purpose chatbot: every output is grounded in indexed club records.</p>
            <CommunityLinks />
            <a className="scroll-hint" href="#knowledge"><span aria-hidden="true">↓</span> Scroll. See what Pluto knows.</a>
          </div>
        </section>
        <section className="orbit-stop right" id="knowledge" aria-labelledby="knowledge-title">
          <div className="story-copy">
            <p className="eyebrow">01 / What Pluto knows</p>
            <h2 id="knowledge-title">Less scattered.<br /><em>More findable.</em></h2>
            <p>Club knowledge gets buried in long threads, split across repositories and easy to miss. Pluto keeps an approved, read-only index of the places the club already works.</p>
            <dl className="feature-list">
              <div><dt>Discord, on an allowlist.</dt><dd>Pluto indexes five configured channels, with new-message intake and a startup backfill. Only allowlisted channels are read; private channels, bot messages and voice are excluded.</dd></div>
              <div><dt>GitHub, public only.</dt><dd>Public Ajiet-DevNation repositories are indexed for READMEs, issues, pull requests, commit messages, contributors and eligible source files.</dd></div>
              <div><dt>Miro, when configured.</dt><dd>Read-only board items and connectors are supported when a token and board access are configured. The shared DevNation workspace and live verification are still pending.</dd></div>
            </dl>
            <p className="fine-print">Pluto never indexes private repositories or private channels. Miro live verification is pending.</p>
          </div>
        </section>
        <section className="orbit-stop" id="how-it-works" aria-labelledby="how-title">
          <div className="story-copy">
            <p className="eyebrow">02 / Everyday awareness</p>
            <h2 id="how-title">Catch up.<br /><em>Stay ahead.</em></h2>
            <ol className="flow">
              <li><h3>An honest activity snapshot.</h3><p><code>/digest</code> covers 1–30 days (default 7) and shows deterministic counts and links for GitHub issues, indexed Discord messages, a <code>#decisions</code> subset, and upcoming meetings and events. It does not generate an AI summary or count PRs and commits.</p></li>
              <li><h3>Meetings and events in one place.</h3><p><code>/upcoming meetings</code> lists confirmed future meetings; <code>/upcoming events</code> lists scheduled club events. Every member can add one with <code>/event add</code> and cancel by ID with <code>/event cancel</code>. Times use Asia/Kolkata and display in 12-hour IST.</p></li>
              <li><h3>A reminder before the meeting.</h3><p>The announcer watches only <code>#meeting-plans</code>. A human announcement with <code>@everyone</code> or <code>@here</code>, meeting language and a clear future time becomes one durable reminder in <code>#pluto</code> one hour before. It never repeats the mass mention.</p></li>
            </ol>
            <p className="fine-print">Meeting detection and reminders passed test-guild checks; production deployment acceptance is pending.</p>
          </div>
        </section>
        <section className="orbit-stop right" id="commands" aria-labelledby="commands-title">
          <div className="story-copy">
            <p className="eyebrow">03 / Try the commands</p>
            <h2 id="commands-title">Less digging.<br /><em>More doing.</em></h2>
            <p>Pick a command to see an illustrative reply. This preview doesn’t connect to Discord.</p>
            <CommandDemo />
          </div>
        </section>
        <section className="orbit-stop" id="boundaries" aria-labelledby="boundaries-title">
          <div className="story-copy">
            <p className="eyebrow">04 / Read-only by design</p>
            <h2 id="boundaries-title">Helpful.<br /><em>Never intrusive.</em></h2>
            <dl className="feature-list">
              <div><dt>Read-only external sources.</dt><dd>Pluto’s GitHub and Miro clients are GET-only and use read-only credentials. It never writes to repositories, edits or deletes Discord history, or changes a Miro board. Posting new Discord messages is allowed.</dd></div>
              <div><dt>Selected channels. Public repositories.</dt><dd>Indexing follows a five-channel allowlist. <code>#pluto</code> and <code>#events</code> are never indexed, and private repositories, private channels, bot messages and voice channels are excluded.</dd></div>
              <div><dt>You can opt out.</dt><dd><code>/optout</code> excludes your messages from future indexing and removes existing indexed records. Opt-out is one-way in v1.</dd></div>
            </dl>
            <p className="fine-print"><code>/ask</code> is not part of active v1. <code>/decisions</code> and transcript workflows are deferred. Pluto never cites its own output channel.</p>
          </div>
        </section>
        <section className="orbit-stop right" id="community" aria-labelledby="community-title">
          <div className="story-copy">
            <p className="eyebrow">05 / Open source. Built at AJIET.</p>
            <h2 id="community-title">A little Pluto.<br /><em>A whole DevNation.</em></h2>
            <p>Pluto is built by student developers at AJIET with TypeScript, Node.js, Discord.js, Neon Postgres, pg-boss and Cloudflare Workers AI. The code is open source.</p>
            <div className="stackline" aria-label="Technology stack"><span>TypeScript</span><span>Node.js 22</span><span>Discord.js</span><span>Neon Postgres</span><span>pgvector</span><span>Drizzle</span><span>pg-boss</span><span>Cloudflare Workers AI</span><span>GitHub App</span><span>Miro REST v2</span></div>
            <CommunityLinks />
            <div className="roadmap"><span className="eyebrow">In the works</span><p>Miro live verification and production acceptance for the meeting announcer are pending. <code>/ask</code> is not an active v1 command.</p></div>
            <footer className="story-footer">Made by <a href="https://www.devnation.club/">DevNation ↗</a><span>Mangaluru, India · Open source / MIT</span></footer>
          </div>
        </section>
      </main>
    </>
  );
}
