"use client";

import { useEffect, useRef, useState } from "react";
import { commandExamples, site } from "@/content/site";

export function CommandDemo() {
  const [selected, setSelected] = useState<number | null>(null);
  const [typing, setTyping] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function select(index: number) {
    if (timer.current) clearTimeout(timer.current);
    setSelected(index);
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTyping(animate);
    if (animate) timer.current = setTimeout(() => setTyping(false), 550);
  }

  const example = selected === null ? null : commandExamples[selected];
  return (
    <div className="chat-demo-wrap">
      <div className="chat-demo">
        <div className="chat-heading">
          <span>
            <span aria-hidden="true">#</span> pluto
          </span>
          <span className="preview-label">Preview</span>
        </div>
        <div className="chat-log" aria-live="polite" aria-atomic="true" aria-busy={typing}>
          {example ? (
            <>
              <div className="chat-message user-message">{example.question}</div>
              <div className="bot-caption">
                <span className="tiny-mascot" aria-hidden="true" />
                Pluto
              </div>
              <div className="chat-message bot-message">
                {typing ? (
                  <span className="typing-dots" aria-label="Pluto is typing">
                    •••
                  </span>
                ) : (
                  example.answer
                )}
              </div>
            </>
          ) : (
            <>
              <div className="bot-caption">
                <span className="tiny-mascot" aria-hidden="true" />
                Pluto
              </div>
              <div className="chat-message bot-message">{site.preview.greeting}</div>
            </>
          )}
        </div>
        <div className="command-chips" aria-label="Example commands">
          {commandExamples.map((item, index) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={selected === index}
              onClick={() => select(index)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <p className="demo-disclaimer">{site.preview.disclaimer}</p>
    </div>
  );
}
