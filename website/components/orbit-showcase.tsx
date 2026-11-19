"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/app/orbit/orbit.module.css";

const greetings = [
  "Hi, I'm Pluto. Your read-only guide to DevNation.",
  "Need a catch-up? Try /digest.",
  "Meetings and events live under /upcoming.",
  "I only read approved sources—never write to them.",
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
    let timeout: number | undefined;
    const start = () => {
      if (!canvas.current?.getContext("webgl2")) return;
      import("./orbit-showcase-engine")
        .then(({ createOrbitShowcase }) => {
          if (disposed || !canvas.current || !guide.current) return;
          try {
            controller.current = createOrbitShowcase(canvas.current, guide.current, (value) => {
              if (!disposed) setReady(value);
            });
          } catch {
            // The CSS starfield and guide remain available without WebGL.
          }
        })
        .catch(() => {
          // Keep the static scene if the chunk is unavailable.
        });
    };
    if (typeof requestIdleCallback === "function") {
      timeout = requestIdleCallback(start, { timeout: 1500 });
    } else {
      timeout = window.setTimeout(start, 0);
    }

    return () => {
      disposed = true;
      if (timeout !== undefined) {
        if (typeof cancelIdleCallback === "function") cancelIdleCallback(timeout);
        else clearTimeout(timeout);
      }
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
      <button
        ref={guide}
        className={styles.guide}
        type="button"
        onClick={sayHello}
        aria-label="Say hello to Pluto"
      >
        <span className={styles.cssGuide} aria-hidden="true" />
        {bubble && (
          <span className={styles.bubble} aria-hidden="true">
            {bubble}
          </span>
        )}
      </button>
      <span className={styles.srOnly} role="status">
        {bubble}
      </span>
    </>
  );
}
