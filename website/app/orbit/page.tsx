import type { Metadata } from "next";
import styles from "./orbit.module.css";
import { OrbitShowcase } from "@/components/orbit-showcase";
import { CommandDemo } from "@/components/command-demo";

export const metadata: Metadata = {
  title: "Pluto — DevNation's knowledge companion",
  description: "Pluto helps DevNation members find updates, meeting details, and project context from Discord, GitHub, and Miro.",
};

export default function OrbitPage() {
  return (
    <>
      <a className={styles.skip} href="#main">Skip to content</a>
      <OrbitShowcase />
      <header className={styles.masthead}>
        <a className={styles.brand} href="#meet" aria-label="Pluto home">
          Pluto<span className={styles.brandByline}> / by DevNation</span>
        </a>
        <nav className={styles.mastheadLinks} aria-label="Main links">
          <a href="https://www.devnation.club/">DevNation ↗</a>
        </nav>
      </header>

      <main id="main">
        {/* Section 1: Introduction */}
        <section className={`${styles.stop} ${styles.hero}`} id="meet" data-orbit-stop aria-labelledby="meet-title">
          <div className={styles.copy}>
            <h1 id="meet-title">Meet Pluto.<br />DevNation&apos;s<br /><em>knowledge companion.</em></h1>
            <p>Pluto reads the club&apos;s Discord, GitHub and Miro so you don&apos;t have to dig. Ask it what&apos;s happening, when the next meeting is, or what a project is about.</p>
            <p className={styles.note}>It only answers from what the club has actually shared.</p>
            <div className={styles.buttonRow}>
              <a className={styles.pill} href="https://github.com/Ajiet-DevNation/pluto">Explore Pluto <span aria-hidden="true">↗</span></a>
              <a className={`${styles.pill} ${styles.secondary}`} href="#knowledge">See what Pluto knows <span aria-hidden="true">↓</span></a>
            </div>
          </div>
        </section>

        {/* Section 2: Where Pluto gets its answers */}
        <section className={styles.stop} id="knowledge" data-orbit-stop aria-labelledby="knowledge-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Where Pluto gets its answers</p>
            <h2 id="knowledge-title">Find the club&apos;s<br /><em>updates.</em></h2>
            <p>Club updates live in conversations, project files, and meeting notes. Pluto helps you find them.</p>
            <div className={styles.featureLines}>
              <article><h3>Discord</h3><p>Find club conversations and updates without searching through old messages.</p></article>
              <article><h3>GitHub</h3><p>See what a project is about and follow the work behind it.</p></article>
              <article><h3>Miro</h3><p>Find shared boards and notes when the club has made them available.</p></article>
            </div>
            <p className={styles.fine}>Pluto only uses information the club has chosen to share.</p>
          </div>
        </section>

        {/* Section 3: Things you can ask Pluto */}
        <section className={styles.stop} id="journey" data-orbit-stop aria-labelledby="journey-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Things you can ask Pluto</p>
            <h2 id="journey-title">What do you need<br /><em>to know?</em></h2>
            <p>Ask Pluto about the things you would otherwise have to piece together yourself.</p>
            <ul className={styles.steps}>
              <li><div><h3>What happened recently?</h3><p>Get a quick look at recent club activity and project updates.</p></div></li>
              <li><div><h3>When is the next meeting?</h3><p>See upcoming meetings and events in one place.</p></div></li>
              <li><div><h3>What is this project about?</h3><p>Get the context you need before joining the conversation.</p></div></li>
            </ul>
            <span className={styles.note}>The answer comes from what the club has shared.</span>
          </div>
        </section>

        {/* Section 4: Try a question */}
        <section className={`${styles.stop} ${styles.scoreStop}`} id="how-it-works" data-orbit-stop aria-labelledby="how-title">
          <div className={`${styles.copy} ${styles.wideCopy}`}>
            <p className={styles.eyebrow}>Try a question</p>
            <h2 id="how-title">Ask Pluto<br /><em>a question.</em></h2>
            <p>Here are a few examples. The preview is not connected to Discord.</p>
            <CommandDemo />
            <div className={styles.featureLines}>
              <article><h3>Ask about the club</h3><p>Find out what happened, what is coming up, or what a project is about.</p></article>
              <article><h3>Find it in one place</h3><p>You do not need to search through old conversations yourself.</p></article>
            </div>
          </div>
        </section>

        {/* Section 5: What Pluto can see */}
        <section className={styles.stop} id="built" data-orbit-stop aria-labelledby="built-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>What Pluto can see</p>
            <h2 id="built-title">It only uses<br /><em>shared information.</em></h2>
            <p>Pluto can use information the club has shared with it. It cannot change the club&apos;s work.</p>
            <dl className={styles.featureLines}>
              <div><dt>Only shared information.</dt><dd>Pluto uses the places and information the club has chosen to make available.</dd></div>
              <div><dt>No changes to your work.</dt><dd>Pluto does not edit projects, boards, or past conversations.</dd></div>
              <div><dt>You can opt out.</dt><dd>Members can ask for their messages to be left out.</dd></div>
            </dl>
            <p className={styles.fine}>Pluto only answers from information it can actually see.</p>
            <p className={styles.eyebrow} style={{marginTop:'2rem'}}>In simple terms</p>
            <ol className={styles.steps}>
              <li><div><h3>Read.</h3><p>Pluto looks at the club&apos;s shared information.</p></div></li>
              <li><div><h3>Understand.</h3><p>It connects the details that help answer your question.</p></div></li>
              <li><div><h3>Reply.</h3><p>It gives you the useful answer in Discord.</p></div></li>
            </ol>
          </div>
        </section>

        {/* Section 6: About the project */}
        <section className={`${styles.stop} ${styles.final}`} id="join" data-orbit-stop aria-labelledby="join-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>About the project</p>
            <h2 id="join-title">A project from<br /><em>DevNation.</em></h2>
            <p>Pluto is made by students at AJIET for DevNation. It helps members find the things the club has already talked about.</p>
            <dl className={styles.featureLines}>
              <article><h3>Open source</h3><p>The code is open for the community to explore and improve.</p></article>
              <article><h3>Want to see more?</h3><p>Explore Pluto or visit DevNation to learn about the club.</p></article>
            </dl>
            <div className={styles.stackline} aria-label="Places Pluto helps with"><span>Discord</span><span>GitHub</span><span>Miro</span><span>Meetings</span><span>Projects</span></div>
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
