"use client";

import { useState } from "react";
import styles from "@/app/orbit/orbit.module.css";

type FieldName =
  | "easy" | "medium" | "hard" | "bestLc"
  | "commits" | "prs" | "stars" | "external" | "points" | "bestGh"
  | "attended" | "events"
  | "lcWeight" | "ghWeight" | "eventWeight";

type Field = { name: FieldName; label: string; min: number; max: number };

const defaults: Record<FieldName, string> = {
  easy: "80", medium: "30", hard: "8", bestLc: "420",
  commits: "55", prs: "12", stars: "18", external: "2", points: "10", bestGh: "360",
  attended: "3", events: "8",
  lcWeight: "33", ghWeight: "33", eventWeight: "34",
};

const groups: { divider: string; fields: Field[] }[] = [
  {
    divider: "LeetCode · easy × 1, medium × 3, hard × 5",
    fields: [
      { name: "easy", label: "Easy solved", min: 0, max: 1000000 },
      { name: "medium", label: "Medium solved", min: 0, max: 1000000 },
      { name: "hard", label: "Hard solved", min: 0, max: 1000000 },
      { name: "bestLc", label: "Cohort’s highest LC raw", min: 0, max: 10000000 },
    ],
  },
  {
    divider: "GitHub · commits + PRs × 2 + stars + external PRs × points",
    fields: [
      { name: "commits", label: "Commits", min: 0, max: 1000000 },
      { name: "prs", label: "Merged PRs", min: 0, max: 1000000 },
      { name: "stars", label: "Stars", min: 0, max: 1000000 },
      { name: "external", label: "Qualifying external PRs", min: 0, max: 1000000 },
      { name: "points", label: "Points per external PR", min: 0, max: 1000 },
      { name: "bestGh", label: "Cohort’s highest GH raw", min: 0, max: 10000000 },
    ],
  },
  {
    divider: "Events · attended ÷ eligible past events × 100",
    fields: [
      { name: "attended", label: "Events attended", min: 0, max: 1000000 },
      { name: "events", label: "Approved, published past events", min: 0, max: 1000000 },
    ],
  },
  {
    divider: "Weights · admin-configurable · sum to 100%",
    fields: [
      { name: "lcWeight", label: "LeetCode %", min: 0, max: 100 },
      { name: "ghWeight", label: "GitHub %", min: 0, max: 100 },
      { name: "eventWeight", label: "Events %", min: 0, max: 100 },
    ],
  },
];

const allFields = groups.flatMap(group => group.fields);
const helper = "GitHub and LeetCode are square-root-normalised against the cohort leader. External PRs must be merged into public repos you do not own, with at least the admin-set minimum stars (default 10).";
const formatter = (value: number) => value.toFixed(1);

type Outcome = { total: string; breakdown: string[]; hint: string; error: boolean };

function evaluate(values: Record<FieldName, string>): Outcome {
  const numbers = {} as Record<FieldName, number>;
  let invalid = false;
  for (const field of allFields) {
    const raw = values[field.name].trim();
    const numeric = Number(raw);
    numbers[field.name] = numeric;
    if (raw === "" || !Number.isSafeInteger(numeric) || numeric < field.min || numeric > field.max) invalid = true;
  }
  if (invalid) {
    return {
      total: "—",
      breakdown: ["Enter whole numbers within each field’s range."],
      hint: "Please use non-negative whole numbers within the displayed limits.",
      error: true,
    };
  }
  if (numbers.attended > numbers.events) {
    return {
      total: "—",
      breakdown: ["Attendance cannot exceed the number of eligible past events."],
      hint: "Reduce events attended or increase the number of eligible past events.",
      error: true,
    };
  }
  if (numbers.lcWeight + numbers.ghWeight + numbers.eventWeight !== 100) {
    return {
      total: "—",
      breakdown: ["Weights must add up to 100%."],
      hint: "Adjust the three weights so their sum is exactly 100%.",
      error: true,
    };
  }
  const lcRaw = numbers.easy + numbers.medium * 3 + numbers.hard * 5;
  const ghRaw = numbers.commits + numbers.prs * 2 + numbers.stars + numbers.external * numbers.points;
  const lc = Math.sqrt(lcRaw) / Math.max(1, Math.sqrt(Math.max(lcRaw, numbers.bestLc))) * 100;
  const gh = Math.sqrt(ghRaw) / Math.max(1, Math.sqrt(Math.max(ghRaw, numbers.bestGh))) * 100;
  const event = numbers.events ? Math.min(100, numbers.attended / numbers.events * 100) : 0;
  const score = lc * numbers.lcWeight / 100 + gh * numbers.ghWeight / 100 + event * numbers.eventWeight / 100;
  return {
    total: formatter(score),
    breakdown: [
      `LC ${formatter(lc)} / 100 · raw ${lcRaw}`,
      `GH ${formatter(gh)} / 100 · raw ${ghRaw}`,
      `Events ${formatter(event)} / 100`,
    ],
    hint: helper,
    error: false,
  };
}

export function OrbitCalculator() {
  const [values, setValues] = useState<Record<FieldName, string>>(defaults);
  const outcome = evaluate(values);

  function update(name: FieldName, value: string) {
    setValues(current => ({ ...current, [name]: value }));
  }

  return (
    <div className={styles.scorecard}>
      <h3>Build a sample score</h3>
      <p>Enter activity and example cohort leaders to see how the real formulas combine them.</p>
      <form
        noValidate
        onSubmit={event => event.preventDefault()}
        onReset={event => { event.preventDefault(); setValues(defaults); }}
      >
        {groups.map(group => (
          <div key={group.divider}>
            <div className={styles.calcDivider}>{group.divider}</div>
            <div className={styles.calculatorFields}>
              {group.fields.map(field => (
                <label key={field.name}>
                  {field.label}
                  <input
                    name={field.name}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step="1"
                    inputMode="numeric"
                    value={values[field.name]}
                    onChange={event => update(field.name, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className={styles.calcResult} aria-live="polite">
          <small>Illustrative total / 100</small>
          <strong>{outcome.total}</strong>
          <div className={styles.breakdown}>
            {outcome.breakdown.map(line => <span key={line}>{line}</span>)}
          </div>
        </div>
        <p className={`${styles.calcHint} ${outcome.error ? styles.error : ""}`}>{outcome.hint}</p>
        <button type="reset">Reset example inputs</button>
      </form>
    </div>
  );
}
