import type { Metadata } from "next";
import { CommandDemo } from "@/components/command-demo";
import { OrbitShowcase } from "@/components/orbit-showcase";
import { site } from "@/content/site";
import styles from "./orbit.module.css";

export const metadata: Metadata = {
  title: site.title,
  description: site.description,
};

export default function OrbitPage() {
  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <OrbitShowcase />
      <header className={styles.masthead}>
        <a className={styles.brand} href="#meet" aria-label="Pluto home">
          Pluto
        </a>
        <nav className={styles.mastheadLinks} aria-label="Main links">
          <a href="https://www.devnation.club/">DevNation</a>
        </nav>
      </header>

      <main id="main">
        <section
          className={`${styles.stop} ${styles.hero}`}
          id="meet"
          data-orbit-stop
          aria-labelledby="meet-title"
        >
          <div className={styles.copy}>
            <h1 id="meet-title">{site.hero.title}</h1>
            <p>{site.hero.description}</p>
            <p className={styles.note}>{site.hero.note}</p>
            <div className={styles.buttonRow}>
              <a className={styles.pill} href="https://github.com/Ajiet-DevNation/pluto">
                Explore Pluto
              </a>
              <a className={`${styles.pill} ${styles.secondary}`} href="#knowledge">
                See what Pluto knows
              </a>
            </div>
          </div>
        </section>

        <section
          className={styles.stop}
          id="knowledge"
          data-orbit-stop
          aria-labelledby="knowledge-title"
        >
          <div className={styles.copy}>
            <h2 id="knowledge-title">{site.sources.title}</h2>
            <p>{site.sources.description}</p>
            <ul className={styles.details}>
              {site.sources.items.map((item) => (
                <li key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          className={styles.stop}
          id="journey"
          data-orbit-stop
          aria-labelledby="journey-title"
        >
          <div className={styles.copy}>
            <h2 id="journey-title">{site.everyday.title}</h2>
            <p>{site.everyday.description}</p>
            <ul className={styles.details}>
              {site.everyday.items.map((item) => (
                <li key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          className={`${styles.stop} ${styles.scoreStop}`}
          id="how-it-works"
          data-orbit-stop
          aria-labelledby="how-title"
        >
          <div className={`${styles.copy} ${styles.wideCopy}`}>
            <h2 id="how-title">{site.preview.title}</h2>
            <CommandDemo />
          </div>
        </section>

        <section className={styles.stop} id="built" data-orbit-stop aria-labelledby="built-title">
          <div className={styles.copy}>
            <h2 id="built-title">{site.privacy.title}</h2>
            <p>{site.privacy.description}</p>
            <ul className={styles.details}>
              {site.privacy.items.map((item) => (
                <li key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          className={`${styles.stop} ${styles.final}`}
          id="join"
          data-orbit-stop
          aria-labelledby="join-title"
        >
          <div className={styles.copy}>
            <h2 id="join-title">{site.about.title}</h2>
            <p>{site.about.description}</p>
            <div className={styles.buttonRow}>
              <a className={styles.pill} href="https://www.devnation.club/">
                Visit DevNation
              </a>
              <a
                className={`${styles.pill} ${styles.secondary}`}
                href="https://github.com/Ajiet-DevNation/pluto"
              >
                Pluto on GitHub
              </a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
