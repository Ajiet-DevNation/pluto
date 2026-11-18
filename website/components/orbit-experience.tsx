"use client";

import { useEffect, useRef, useState } from "react";

const stops = [
  ["meet", "Meet Pluto"], ["knowledge", "The problem"],
  ["journey", "Everyday awareness"], ["how-it-works", "Commands"],
  ["built", "Privacy & how it works"], ["join", "Examples & DevNation"],
] as const;
const greetings = ["Hi, I'm Pluto. Your read-only guide to DevNation.", "Need a catch-up? Try /digest.", "Meetings and events live under /upcoming.", "I only read approved sources—never write to them."];

export function OrbitExperience() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mascot = useRef<HTMLButtonElement>(null);
  const controller = useRef<{ dispose: () => void; setPaused: (value: boolean) => void } | null>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const greeting = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;
    import("./orbit-engine").then(({ createOrbit }) => {
      if (disposed || !canvas.current || !mascot.current) return;
      try {
        controller.current = createOrbit(canvas.current, mascot.current, (value) => {
          if (!disposed) setReady(value);
        });
      } catch {
        // The server-rendered starfield and CSS character remain usable without WebGL.
      }
    }).catch(() => { /* Keep the static fallback on chunk/network failure. */ });

    const sections = stops.map(([id]) => document.getElementById(id)!);
    let frame = 0;
    function update() {
      frame = 0;
      let nearest = 0;
      let distance = Infinity;
      sections.forEach((section, index) => {
        const rect = section.getBoundingClientRect();
        const next = Math.abs(rect.top + rect.height / 2 - innerHeight / 2);
        if (next < distance) { distance = next; nearest = index; }
      });
      setActive(nearest);
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    schedule();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    return () => {
      disposed = true;
      controller.current?.dispose();
      controller.current = null;
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => { controller.current?.setPaused(paused); }, [paused, ready]);

  function sayHello() {
    if (timer.current) clearTimeout(timer.current);
    setBubble(greetings[greeting.current++ % greetings.length]);
    timer.current = setTimeout(() => setBubble(null), 3500);
  }

  return <>
    <div className="orbit-world" data-ready={ready} aria-hidden="true"><div className="space-fallback"><div className="fallback-planet" /></div><canvas ref={canvas} className="orbit-canvas" /></div>
    <button ref={mascot} className="mascot-target" data-ready={ready} type="button" onClick={sayHello} aria-label="Say hello to Pluto"><span className="fallback-character" aria-hidden="true"><span className="fallback-face"><span className="fallback-eyes" /></span><span className="fallback-suit" /></span>{bubble && <span className="mascot-bubble" aria-hidden="true">{bubble}</span>}</button>
    <span className="sr-only" role="status">{bubble}</span>
    <nav className="section-nav" aria-label="Explore Pluto">{stops.map(([id, label], index) => <a key={id} href={`#${id}`} aria-label={label} aria-current={active === index ? "location" : undefined}><span>{label}</span></a>)}</nav>
    <div className="world-controls">{ready && <button className="motion-button" type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? "▷ Resume motion" : "Ⅱ Pause motion"}</button>}<span className="journey-label">0{active + 1} / 06 — {stops[active][1]}</span></div>
  </>;
}
