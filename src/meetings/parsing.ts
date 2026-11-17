/**
 * Deterministic meeting date/time parsing (L3).
 *
 * All input is interpreted in Asia/Kolkata (UTC+05:30, no daylight saving).
 * Relative dates are anchored to the announcement message's createdAt, never
 * the processing wall-clock. Missing, ambiguous, invalid or past date/time
 * information results in a clarification request — never a silent guess.
 *
 * No AI provider or date-fns-tz dependency is used; timezone math is manual
 * because Asia/Kolkata is a fixed offset.
 */

export const MEETING_TIMEZONE = 'Asia/Kolkata';
// Asia/Kolkata is fixed UTC+05:30 with no DST.
const KOLKATA_OFFSET_MS = (5 * 60 * 60 + 30 * 60) * 1000;

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
} as const;

const MONTH_NAMES = Object.keys(MONTHS);
const WEEKDAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
} as const;

export interface TimeResult {
  present: boolean;
  hour?: number;
  minute?: number;
  ambiguous?: boolean;
  invalid?: boolean;
  reason?: string;
}

export interface DateResult {
  present: boolean;
  year?: number;
  month?: number;
  day?: number;
  ambiguous?: boolean;
  invalid?: boolean;
  reason?: string;
}

export interface ParseResult {
  kind: 'ok' | 'clarify';
  title?: string;
  startAt?: Date;
  timezone: string;
  reminderAt?: Date;
  clarification?: string;
}

export interface ParseOpts {
  now?: () => Date;
}

function nowMs(opts: ParseOpts): number {
  return (opts.now ?? (() => new Date()))().getTime();
}

/** Interpret Kolkata wall-clock components as a true UTC instant. */
function toKolkataInstant(year: number, month: number, day: number, hour: number, minute: number): number {
  // Date.UTC treats the components as UTC; Kolkata wall time is 5:30 ahead of
  // UTC, so shifting back 5:30 yields the real UTC instant.
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0) - KOLKATA_OFFSET_MS;
}

/** Convert a UTC instant back to its Asia/Kolkata wall-calendar components. */
function toKolkataWall(instant: number) {
  const d = new Date(instant + KOLKATA_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(), // Sunday = 0
  };
}

function addDays(y: number, m: number, d: number, days: number) {
  const base = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - KOLKATA_OFFSET_MS;
  const wall = toKolkataWall(base + days * 24 * 60 * 60 * 1000);
  return { year: wall.year, month: wall.month, day: wall.day };
}

function monthIndex(name: string): number | undefined {
  return MONTHS[name as keyof typeof MONTHS];
}

function weekdayIndex(name: string): number | undefined {
  return WEEKDAYS[name as keyof typeof WEEKDAYS];
}

function monthName(month: number): string {
  const entry = Object.entries(MONTHS).find(([, v]) => v === month);
  return entry ? entry[0] : String(month);
}

/* ---------- time extraction ---------- */

function extractTime(content: string): TimeResult {
  // 1. HH:MM [AM|PM] — without meridiem this is 24-hour (task rule).
  const m = content.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    const meridiem = (m[3] || '').toUpperCase();
    if (meridiem) {
      if (h < 1 || h > 12) {
        return { present: true, invalid: true, reason: 'hour-with-meridiem-out-of-range' };
      }
      let hour24 = h === 12 ? 0 : h;
      if (meridiem === 'PM') hour24 += 12;
      return { present: true, hour: hour24, minute: min, ambiguous: false };
    }
    if (h < 0 || h > 23 || min < 0 || min > 59) {
      return { present: true, invalid: true, reason: 'invalid-24h-time' };
    }
    return { present: true, hour: h, minute: min, ambiguous: false };
  }

  // 2. bare hour + AM/PM (e.g. "4 PM", "10 AM")
  const m2 = content.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (m2) {
    const h = Number(m2[1]);
    if (h < 1 || h > 12) {
      return { present: true, invalid: true, reason: 'bare-hour-with-meridiem-out-of-range' };
    }
    let hour24 = h === 12 ? 0 : h;
    if (m2[2].toUpperCase() === 'PM') hour24 += 12;
    return { present: true, hour: hour24, minute: 0, ambiguous: false };
  }

  // 3. bare hour in "at <number>" context — ambiguous (05:00 or 17:00)
  const m3 = content.match(/\bat\s+(\d{1,2})\b/i);
  if (m3) {
    const h = Number(m3[1]);
    if (h >= 1 && h <= 12) {
      return { present: true, hour: h, ambiguous: true, reason: 'bare-hour-ambiguous' };
    }
  }

  return { present: false };
}

/* ---------- date extraction ---------- */

function extractDate(content: string, anchor: Date): DateResult {
  const lower = content.toLowerCase();
  const anchorWall = toKolkataWall(anchor.getTime());

  // day after tomorrow
  if (/day after tomorrow/.test(lower)) {
    const w = addDays(anchorWall.year, anchorWall.month, anchorWall.day, 2);
    return { present: true, year: w.year, month: w.month, day: w.day };
  }

  // tomorrow
  if (/\btomorrow\b/.test(lower)) {
    const w = addDays(anchorWall.year, anchorWall.month, anchorWall.day, 1);
    return { present: true, year: w.year, month: w.month, day: w.day };
  }

  // today
  if (/\btoday\b/.test(lower)) {
    return {
      present: true,
      year: anchorWall.year,
      month: anchorWall.month,
      day: anchorWall.day,
    };
  }

  // weekday name — next occurrence after anchor; same weekday is ambiguous
  const wMatch = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (wMatch) {
    const target = weekdayIndex(wMatch[1] as keyof typeof WEEKDAYS)!;
    const anchorIdx = anchorWall.weekday;
    let diff = (target - anchorIdx + 7) % 7;
    if (diff === 0) {
      return { present: true, ambiguous: true, reason: 'weekday-is-message-day' };
    }
    const w = addDays(anchorWall.year, anchorWall.month, anchorWall.day, diff);
    return { present: true, year: w.year, month: w.month, day: w.day };
  }

  // Month DD, YYYY (e.g. "November 18, 2026")
  const m1 = lower.match(
    new RegExp(`\\b(${MONTH_NAMES.join('|')})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`),
  );
  if (m1) {
    const month = monthIndex(m1[1] as keyof typeof MONTHS)!;
    const day = Number(m1[2]);
    const year = Number(m1[3]);
    if (day < 1 || day > 31) {
      return { present: true, invalid: true, reason: 'day-out-of-range' };
    }
    return { present: true, year, month, day };
  }

  // DD Month (e.g. "18 November") — year defaults to anchor year
  const m2 = lower.match(
    new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES.join('|')})\\b`),
  );
  if (m2) {
    const day = Number(m2[1]);
    const month = monthIndex(m2[2] as keyof typeof MONTHS)!;
    if (day < 1 || day > 31) {
      return { present: true, invalid: true, reason: 'day-out-of-range' };
    }
    return { present: true, year: anchorWall.year, month, day };
  }

  // Month DD (e.g. "November 18")
  const m3 = lower.match(
    new RegExp(`\\b(${MONTH_NAMES.join('|')})\\s+(\\d{1,2})\\b`),
  );
  if (m3) {
    const month = monthIndex(m3[1] as keyof typeof MONTHS)!;
    const day = Number(m3[2]);
    if (day < 1 || day > 31) {
      return { present: true, invalid: true, reason: 'day-out-of-range' };
    }
    return { present: true, year: anchorWall.year, month, day };
  }

  // Numeric DD/MM — day-first. Ambiguous when both parts <= 12 and differ.
  const m4 = content.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (m4) {
    const day = Number(m4[1]);
    const month = Number(m4[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) {
      return { present: true, invalid: true, reason: 'invalid-numeric-date' };
    }
    if (day <= 12 && month <= 12 && day !== month) {
      return { present: true, ambiguous: true, reason: 'numeric-date-order-ambiguous' };
    }
    return { present: true, year: anchorWall.year, month, day };
  }

  return { present: false };
}

/* ---------- composition ---------- */

export function formatKolkataTime(instant: number): string {
  const d = new Date(instant + KOLKATA_OFFSET_MS);
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function formatKolkataDate(instant: number): string {
  const d = new Date(instant + KOLKATA_OFFSET_MS);
  return `${d.getUTCDate()} ${monthName(d.getUTCMonth() + 1)} ${d.getUTCFullYear()}`;
}

function clarify(message: string): ParseResult {
  return { kind: 'clarify', timezone: MEETING_TIMEZONE, clarification: message };
}

export function parseMeeting(
  content: string,
  anchorCreatedAt: Date,
  opts: ParseOpts = {},
): ParseResult {
  const title = content.trim();
  const time = extractTime(content);
  const date = extractDate(content, anchorCreatedAt);
  const now = nowMs(opts);

  if (time.invalid) {
    return clarify('The time is invalid (for example 25:00 or 13 PM). Please use HH:MM in 24-hour form, or H AM/PM.');
  }
  if (!date.present) {
    return clarify('I could not find a date. Please say today, tomorrow, a weekday, or an explicit date (for example "18 November").');
  }
  if (date.invalid) {
    return clarify(`Invalid date: ${date.reason ?? ''}.`);
  }
  if (date.ambiguous) {
    return clarify(`The date is ambiguous (${date.reason ?? ''}). Please clarify whether you mean day-first or month-first, or today versus next week.`);
  }
  if (!time.present) {
    return clarify('I could not find a time. Please include a time such as "4 PM" or "15:00".');
  }
  if (time.ambiguous) {
    const h = time.hour!;
    const am = String(h).padStart(2, '0') + ':00';
    const pm = String(((h + 12) % 24) === 0 ? 12 : (h + 12) % 24).padStart(2, '0') + ':00';
    return clarify(
      `The time "${h}" is ambiguous — did you mean ${am} or ${pm} Asia/Kolkata? Please specify AM or PM.`,
    );
  }

  const startAtMs = toKolkataInstant(date.year!, date.month!, date.day!, time.hour!, time.minute!);
  const startAt = new Date(startAtMs);

  if (startAtMs <= now) {
    return clarify(
      `The resolved time ${formatKolkataDate(startAtMs)} ${formatKolkataTime(startAtMs)} Asia/Kolkata is already in the past. Please propose a future date/time.`,
    );
  }

  const reminderAtMs = startAtMs - 60 * 60 * 1000;
  return {
    kind: 'ok',
    title,
    startAt,
    timezone: MEETING_TIMEZONE,
    reminderAt: new Date(reminderAtMs),
  };
}
