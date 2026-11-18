"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/app/orbit/orbit.module.css";

const greetings = [
  "Hi, I’m Pluto. Welcome to Orbit!",
  "Keep going. There’s more around the bend.",
  "Let’s build together!",
  "See you out there, DevNation.",
];

export function OrbitShowcase() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const guide = useRef<HTMLButtonElement>(null);
  const controller = useRef<{ dispose: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greeting = useRef(0);
  const [ready, setReady] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    import("./orbit-showcase-engine").then(({ createOrbitShowcase }) => {
      if (disposed || !canvas.current || !guide.current) return;
      try {
        controller.current = createOrbitShowcase(canvas.current, guide.current, value => {
          if (!disposed) setReady(value);
        });
      } catch {
        // Without WebGL the CSS starfield and guide remain usable.
      }
    }).catch(() => { /* Keep the static fallback on chunk failure. */ });

    return () => {
      disposed = true;
      controller.current?.dispose();
      controller.current = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function sayHello() {
    if (timer.current) clearTimeout(timer.current);
    setBubble(greetings[greeting.current++ % greetings.length]);
    timer.current = setTimeout(() => setBubble(null), 3200);
  }

  return (
    <>
      <div className={styles.world} data-ready={ready} aria-hidden="true">
        <canvas ref={canvas} className={styles.scene} />
      </div>
      <button ref={guide} className={styles.guide} type="button" onClick={sayHello} aria-label="Say hello to Pluto">
        <span className={styles.cssGuide} aria-hidden="true" />
        {bubble && <span className={styles.bubble} aria-hidden="true">{bubble}</span>}
      </button>
      <span className={styles.srOnly} role="status">{bubble}</span>
    </>
  );
}
