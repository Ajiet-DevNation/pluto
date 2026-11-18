import type { Metadata } from "next";
import styles from "./orbit.module.css";
import { OrbitShowcase } from "@/components/orbit-showcase";
import { OrbitCalculator } from "@/components/orbit-calculator";

export const metadata: Metadata = {
  title: "DevNation Orbit — Build. Learn. Connect. Grow.",
  description: "Meet DevNation Orbit: events, member projects and a fairer way to see the work behind the leaderboard. Pluto shows you around.",
};

export default function OrbitPage() {
  return (
    <>
      <a className={styles.skip} href="#main">Skip to content</a>
      <OrbitShowcase />
      <header className={styles.masthead}>
        <a className={styles.brand} href="#meet" aria-label="DevNation Orbit, start of page">
          <span className={styles.brandOrbit} aria-hidden="true" />DEVNATION <small>/ ORBIT</small>
        </a>
        <nav className={styles.mastheadLinks} aria-label="Main links">
          <a href="https://github.com/Ajiet-DevNation/dn-orbit">The code ↗</a>
          {/* TODO: Supply approved sign-in URL. */}
          <a href="#" aria-label="Sign in (destination to be added)">Sign in ↗</a>
        </nav>
      </header>

      <main id="main">
        <section className={`${styles.stop} ${styles.hero}`} id="meet" data-orbit-stop aria-labelledby="meet-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}><span className={styles.mark}>✦</span>DevNation / the place where we grow</p>
            <h1 id="meet-title">A place to<br />find your <em>orbit.</em></h1>
            <p>Meet DevNation Orbit. Events to show up for, projects to build together, and a leaderboard that follows the work behind the scenes. Pluto will show you around.</p>
            <p className={styles.note}>Build. Learn. Connect. Grow.</p>
            <div className={styles.buttonRow}>
              <a className={styles.pill} href="https://www.devnation.club/">Explore Orbit <span aria-hidden="true">↗</span></a>
              <a className={`${styles.pill} ${styles.secondary}`} href="#activity">Follow Pluto <span aria-hidden="true">↓</span></a>
            </div>
            <a className={styles.scrollIndicator} href="#activity"><span aria-hidden="true">↓</span>See what makes Orbit work.</a>
          </div>
        </section>

        <section className={styles.stop} id="activity" data-orbit-stop aria-labelledby="activity-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>What lives in Orbit</p>
            <h2 id="activity-title">A club is more<br />than a <em>feed.</em></h2>
            <p>Orbit brings the things DevNation members make and do into one place.</p>
            <div className={styles.featureLines}>
              <article><h3>Events you can actually join.</h3><p>Browse approved, published events. Registration respects audience, deadlines and available seats; organisers can review attendance and feedback.</p></article>
              <article><h3>Projects with a story.</h3><p>Members submit their builds and track milestones. Approved submissions and approved GitHub-org imports appear in the public showcase.</p></article>
              <article><h3>People behind the work.</h3><p>Explore the public member directory and a leaderboard built from coding activity and attended events.</p></article>
            </div>
          </div>
        </section>

        <section className={styles.stop} id="journey" data-orbit-stop aria-labelledby="journey-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>How a member finds their feet</p>
            <h2 id="journey-title">Come curious.<br /><em>Leave connected.</em></h2>
            <ul className={styles.steps}>
              <li><div><h3>Explore freely.</h3><p>Events, approved projects, members and leaderboard standings are browsable without signing in.</p></div></li>
              <li><div><h3>Join with your GitHub identity.</h3><p>Sign-in is for allowlisted people. Onboarding adds profile details; admins review membership and manage role-based access.</p></div></li>
              <li><div><h3>Make something together.</h3><p>Approved members can propose events and submit projects for review. Event eligibility depends on the audience; approved member registrations and attendance feed the event score.</p></div></li>
            </ul>
            <span className={styles.note}>The public site remains open. Admin tools are for authorised club roles.</span>
          </div>
        </section>

        <section className={`${styles.stop} ${styles.scoreStop}`} id="scores" data-orbit-stop aria-labelledby="scores-title">
          <div className={`${styles.copy} ${styles.wideCopy}`}>
            <p className={styles.eyebrow}>Explore the scoring model</p>
            <h2 id="scores-title">Every contribution<br /><em>has its place.</em></h2>
            <p>Try an example. These inputs are hypothetical—not a live member score or a predicted rank.</p>
            <OrbitCalculator />
          </div>
        </section>

        <section className={styles.stop} id="built" data-orbit-stop aria-labelledby="built-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Under the hood</p>
            <h2 id="built-title">Made by builders.<br /><em>For builders.</em></h2>
            <p>Orbit is a real club platform, not a score painted on a poster. Its event and project data, member profiles and calculated standings live behind a full-stack application.</p>
            <div className={styles.featureLines}>
              <article><h3>A board that moves with the work.</h3><p>Page visits drain small batches of stale GitHub and LeetCode stats. A GitHub webhook can put new activity first in the queue; scores are recalculated when data changes.</p></article>
              <article><h3>Moderation where it matters.</h3><p>Admins manage approval, visibility and scoring weights. Public project and event listings only include reviewed content.</p></article>
            </div>
            <div className={styles.stackline} aria-label="Technology stack"><span>Next.js</span><span>React</span><span>TypeScript</span><span>Prisma</span><span>Neon PostgreSQL</span><span>GitHub OAuth</span><span>Vercel</span></div>
            <p className={styles.fine}>The calculator above is a standalone example, not connected to Orbit’s database or account system.</p>
          </div>
        </section>

        <section className={`${styles.stop} ${styles.final}`} id="join" data-orbit-stop aria-labelledby="join-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>There’s room in the orbit</p>
            <h2 id="join-title">Build. Learn.<br /><em>Connect. Grow.</em></h2>
            <p>Come see the events, discover what the community is building, and find your people. Pluto will be here when you arrive.</p>
            <div className={styles.buttonRow}>
              <a className={styles.pill} href="https://www.devnation.club/">Visit DevNation Orbit <span aria-hidden="true">↗</span></a>
              {/* TODO: Replace sign-in destination when approved. */}
              <a className={`${styles.pill} ${styles.secondary}`} href="#">Sign in <span aria-hidden="true">↗</span></a>
            </div>
            <footer className={styles.footer}>An open-source project by DevNation at AJIET. <a href="https://github.com/Ajiet-DevNation/dn-orbit">Explore the repository ↗</a></footer>
          </div>
        </section>
      </main>
    </>
  );
}
