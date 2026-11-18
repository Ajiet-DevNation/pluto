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
            <p className="eyebrow"><span className="status-light" /> A little bot. A shared universe.</p>
            <h1 id="meet-title">Meet Pluto,<br />DevNation’s<br /><em>Discord companion.</em></h1>
            <p>Project activity, upcoming events, and meeting reminders—right where the club already talks.</p>
            <CommunityLinks />
            <a className="scroll-hint" href="#knowledge"><span aria-hidden="true">↓</span> Scroll. Pluto will show you around.</a>
          </div>
        </section>
        <section className="orbit-stop right" id="knowledge" aria-labelledby="knowledge-title">
          <div className="story-copy">
            <p className="eyebrow">01 / Keep up with the community</p>
            <h2 id="knowledge-title">The latest,<br /><em>without the hunt.</em></h2>
            <p>Catch up with the club in a few commands, without digging through every channel.</p>
            <dl className="feature-list">
              <div><dt>An activity snapshot.</dt><dd><code>/digest</code> counts recently created GitHub issues and messages in selected Discord channels, including decisions. Choose a window of 1–30 days.</dd></div>
              <div><dt>Plans in one place.</dt><dd><code>/upcoming meetings</code> and <code>/upcoming events</code> list what’s scheduled next, with dates shown in India time.</dd></div>
              <div><dt>Events you can manage.</dt><dd>Members can add an event with <code>/event add</code>. Creators or members with Manage Events can cancel it.</dd></div>
            </dl>
            <p className="fine-print">The digest reports recorded activity, not an AI-written summary or a list of all GitHub contributions.</p>
          </div>
        </section>
        <section className="orbit-stop" id="how-it-works" aria-labelledby="how-title">
          <div className="story-copy">
            <p className="eyebrow">02 / From plans to reminders</p>
            <h2 id="how-title">Make a plan.<br /><em>Stay in orbit.</em></h2>
            <ol className="flow">
              <li><h3>Announce a meeting.</h3><p>Pluto looks for meeting announcements in the club’s selected meeting-plans channel.</p></li>
              <li><h3>Pluto tracks the time.</h3><p>It parses a clear date and time, records the meeting, and schedules a durable reminder.</p></li>
              <li><h3>Everyone stays informed.</h3><p>The reminder appears in the Pluto channel without repeating a mass mention. Check confirmed plans with <code>/upcoming meetings</code>.</p></li>
            </ol>
            <p className="fine-print">Meeting detection and reminders passed test-guild checks; production deployment acceptance is pending.</p>
          </div>
        </section>
        <section className="orbit-stop right" id="commands" aria-labelledby="commands-title">
          <div className="story-copy">
            <p className="eyebrow">03 / A quick preview</p>
            <h2 id="commands-title">Less scrolling.<br /><em>More doing.</em></h2>
            <p>Pick a command to see an illustrative reply. This preview doesn’t connect to Discord.</p>
            <CommandDemo />
          </div>
        </section>
        <section className="orbit-stop" id="boundaries" aria-labelledby="boundaries-title">
          <div className="story-copy">
            <p className="eyebrow">04 / Helpful, with boundaries</p>
            <h2 id="boundaries-title">Your community.<br /><em>Your choice.</em></h2>
            <dl className="feature-list">
              <div><dt>Read-only external sources.</dt><dd>Pluto doesn’t change GitHub repositories, edit Discord history, or write to Miro boards. Members can still create and cancel club events through Pluto.</dd></div>
              <div><dt>Selected channels. Public repositories.</dt><dd>Indexing follows an explicit channel allowlist. Private repositories, private channels, and bot-authored messages are excluded.</dd></div>
              <div><dt>You can opt out.</dt><dd><code>/optout</code> stops future indexing of your messages and removes your existing indexed records. Opt-out is one-way in v1.</dd></div>
            </dl>
            <p className="fine-print">Pluto never indexes its own replies. Voice recording is outside its scope.</p>
          </div>
        </section>
        <section className="orbit-stop right" id="community" aria-labelledby="community-title">
          <div className="story-copy">
            <p className="eyebrow">05 / Built here. Growing together.</p>
            <h2 id="community-title">A little Pluto.<br /><em>A whole DevNation.</em></h2>
            <p>Open source, built by the student developer community at AJIET. Explore the code, follow along, and help shape what comes next.</p>
            <CommunityLinks />
            <div className="roadmap"><span className="eyebrow">In the works</span><p>Miro board indexing and production acceptance for the meeting announcer are still pending. <code>/ask</code> is not an active v1 command.</p></div>
            <footer className="story-footer">Made by <a href="https://www.devnation.club/">DevNation ↗</a><span>Mangaluru, India · Open source / MIT</span></footer>
          </div>
        </section>
      </main>
    </>
  );
}
