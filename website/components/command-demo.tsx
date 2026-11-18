"use client";

import { useEffect, useRef, useState } from "react";

const examples = [
  { label: "/digest", question: "/digest days:14", answer: "Activity digest — last 14 days. GitHub issues created: 3. Discord messages indexed: 12. #decisions: 2. Upcoming meetings: 1. Upcoming events: 1. PRs and commits are not counted. Counts are illustrative." },
  { label: "/upcoming meetings", question: "/upcoming meetings", answer: "Confirmed upcoming meetings: 1. DevNation sync · 20 Nov, 6:00 PM IST. This is an example, not a live meeting." },
  { label: "/upcoming events", question: "/upcoming events", answer: "Scheduled upcoming events: DevNation workshop · ID 42 · 22 Nov, 10:00 AM IST. This is an example, not a live event listing." },
  { label: "/event add", question: "/event add title:Workshop date:YYYY-MM-DD time:10:00 AM end:5:00 PM", answer: "Event saved and posted to #events. Event ID 43 · 22 Nov, 10:00 AM–5:00 PM IST. This is a preview; no event was created." },
  { label: "/event cancel", question: "/event cancel id:42", answer: "Event 42 cancelled; a public notice was posted in #events. This is a preview; no event was changed." },
  { label: "/optout", question: "/optout", answer: "Opt-out excludes your messages from future indexing and removes existing indexed records. This preview hasn’t changed any Discord settings. In v1, opt-out is one-way." },
];

export function CommandDemo() {
  const [selected, setSelected] = useState<number | null>(null);
  const [typing, setTyping] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function select(index: number) {
    if (timer.current) clearTimeout(timer.current);
    setSelected(index);
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTyping(animate);
    if (animate) timer.current = setTimeout(() => setTyping(false), 550);
  }

  const example = selected === null ? null : examples[selected];
  return (
    <div className="chat-demo">
      <div className="chat-heading"><span><span aria-hidden="true">#</span> pluto</span><span className="preview-label">Interactive preview</span></div>
      <div className="chat-log" aria-live="polite" aria-atomic="true" aria-busy={typing}>
        {example ? <>
          <div className="chat-message user-message">{example.question}</div>
          <div className="bot-caption"><span className="tiny-mascot" aria-hidden="true" />Pluto <span>APP</span></div>
          <div className="chat-message bot-message">{typing ? <span className="typing-dots" aria-label="Pluto is typing">•••</span> : example.answer}</div>
        </> : <><div className="bot-caption"><span className="tiny-mascot" aria-hidden="true" />Pluto <span>APP</span></div><div className="chat-message bot-message">Hey, I’m Pluto. Pick a command below to see how I help the club keep up.</div></>}
      </div>
      <div className="command-chips" aria-label="Example commands">{examples.map((item, index) => <button key={item.label} type="button" aria-pressed={selected === index} onClick={() => select(index)}>{item.label}</button>)}</div>
      <p className="demo-disclaimer">Illustrative replies · no Discord connection or account changes</p>
    </div>
  );
}
