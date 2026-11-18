/**
 * Deterministic Asia/Kolkata date and time handling for P3.
 *
 * Manual events are entered as strict `YYYY-MM-DD` values and a time that may
 * be either 12-hour (`4:30 PM`, `4:30PM`, `4 PM`) or 24-hour (`16:30`). Both
 * normalize to a timezone-aware instant. All bot output uses 12-hour IST.
 * India Standard Time has a fixed offset of UTC+05:30 for every supported
 * year, so no external timezone library is needed. All calculations are pure
 * and testable.
 */

export const IST_TIMEZONE = 'Asia/Kolkata';
export const IST_OFFSET_MINUTES = 330;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export interface ClockTime {
  hour: number;
  minute: number;
}

export interface IstParts extends CalendarDate, ClockTime {
  /** 0 = Sunday. */
  weekday: number;
}

export type EventTimingFailure =
  | 'invalid-date'
  | 'invalid-time'
  | 'invalid-end'
  | 'past'
  | 'end-before-start';

export type EventTimingResult =
  | { ok: true; startAt: Date; endAt: Date | null }
  | { ok: false; reason: EventTimingFailure; message: string };

export const EVENT_TIMING_MESSAGES: Record<EventTimingFailure, string> = {
  'invalid-date': 'Date must be a real calendar date in strict YYYY-MM-DD format.',
  'invalid-time':
    'Time must be 12-hour h:MM AM/PM or 24-hour HH:MM in Asia/Kolkata time (for example 4:30 PM or 16:30).',
  'invalid-end':
    'End time must be a valid time in Asia/Kolkata (for example 5:30 PM or 17:30).',
  past: 'The event start must be in the future (Asia/Kolkata).',
  'end-before-start':
    'The end time must be after the start time on the same date.',
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Strict `YYYY-MM-DD`; rejects impossible dates such as 2026-02-30. */
export function parseCalendarDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const roundtrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundtrip.getUTCFullYear() !== year ||
    roundtrip.getUTCMonth() !== month - 1 ||
    roundtrip.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** Strict 24-hour `HH:MM`; rejects 24:00, 9:00 and 10:60. */
export function parseClockTime(value: string): ClockTime | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Accept either a strict 24-hour `HH:MM` value or a 12-hour value:
 * `h:MM AM`, `hh:MM PM`, `h:MMam`, `h PM`, with optional dots (`a.m.`).
 * Returns the normalized 24-hour clock time.
 */
export function parseClockTimeInput(value: string): ClockTime | null {
  const trimmed = value.trim();
  const twentyFour = parseClockTime(trimmed);
  if (twentyFour) {
    return twentyFour;
  }

  const withMinutes = /^(\d{1,2}):([0-5]\d)\s*([AaPp])\.?([Mm])\.?$/.exec(
    trimmed,
  );
  if (withMinutes) {
    return normalizeTwelveHour(
      Number(withMinutes[1]),
      Number(withMinutes[2]),
      withMinutes[3],
    );
  }

  const hourOnly = /^(\d{1,2})\s*([AaPp])\.?([Mm])\.?$/.exec(trimmed);
  if (hourOnly) {
    return normalizeTwelveHour(Number(hourOnly[1]), 0, hourOnly[2]);
  }

  return null;
}

function normalizeTwelveHour(
  hour12: number,
  minute: number,
  meridiem: string,
): ClockTime | null {
  if (hour12 < 1 || hour12 > 12) {
    return null;
  }
  const isPm = meridiem.toUpperCase() === 'P';
  return {
    hour: (hour12 % 12) + (isPm ? 12 : 0),
    minute,
  };
}

export function istToInstant(date: CalendarDate, time: ClockTime): Date {
  return new Date(
    Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute) -
      IST_OFFSET_MINUTES * MINUTE_MS,
  );
}

export function instantToIst(instant: Date): IstParts {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * MINUTE_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

function formatIstPartsDate(parts: IstParts): string {
  return `${pad2(parts.day)} ${MONTH_NAMES[parts.month - 1]} ${parts.year}`;
}

/** Example: `10:00 AM`, `12:00 PM`, `4:30 PM`. */
function formatIstPartsTime(parts: IstParts): string {
  const meridiem = parts.hour >= 12 ? 'PM' : 'AM';
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${hour12}:${pad2(parts.minute)} ${meridiem}`;
}

/** Example: `10:00 AM` (no date). */
export function formatIstTime(instant: Date): string {
  return formatIstPartsTime(instantToIst(instant));
}

/** Example: `Sun, 22 Nov 2026, 10:00 AM IST`. */
export function formatIstDateTime(instant: Date): string {
  const parts = instantToIst(instant);
  return `${WEEKDAY_NAMES[parts.weekday]}, ${formatIstPartsDate(parts)}, ${formatIstPartsTime(
    parts,
  )} IST`;
}

/** Example: `22 Nov 2026, 11:41 AM IST` (compact, used for digest windows). */
export function formatIstDateTimeCompact(instant: Date): string {
  const parts = instantToIst(instant);
  return `${formatIstPartsDate(parts)}, ${formatIstPartsTime(parts)} IST`;
}

export function formatIstDate(instant: Date): string {
  return formatIstPartsDate(instantToIst(instant));
}

/**
 * Example: `Sun, 22 Nov 2026, 10:00 AM–12:00 PM IST`, or a full range across
 * days.
 */
export function formatIstRange(startAt: Date, endAt: Date | null): string {
  if (!endAt) {
    return formatIstDateTime(startAt);
  }

  const start = instantToIst(startAt);
  const end = instantToIst(endAt);
  const sameDay =
    start.year === end.year && start.month === end.month && start.day === end.day;

  if (sameDay) {
    return `${WEEKDAY_NAMES[start.weekday]}, ${formatIstPartsDate(start)}, ${formatIstPartsTime(
      start,
    )}–${formatIstPartsTime(end)} IST`;
  }

  return `${formatIstDateTime(startAt)} – ${formatIstDateTime(endAt)}`;
}

export interface EventTimingInput {
  date: string;
  time: string;
  end?: string | null;
}

/**
 * Validate a strict date/time pair in Asia/Kolkata.
 *
 * The start must be strictly in the future. An optional end time is on the
 * same calendar date and must be after the start.
 */
export function resolveEventTiming(
  input: EventTimingInput,
  now: Date,
): EventTimingResult {
  const date = parseCalendarDate(input.date);
  if (!date) {
    return {
      ok: false,
      reason: 'invalid-date',
      message: EVENT_TIMING_MESSAGES['invalid-date'],
    };
  }

  const time = parseClockTimeInput(input.time);
  if (!time) {
    return {
      ok: false,
      reason: 'invalid-time',
      message: EVENT_TIMING_MESSAGES['invalid-time'],
    };
  }

  const startAt = istToInstant(date, time);
  if (startAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'past', message: EVENT_TIMING_MESSAGES.past };
  }

  let endAt: Date | null = null;
  if (input.end?.trim()) {
    const endTime = parseClockTimeInput(input.end);
    if (!endTime) {
      return {
        ok: false,
        reason: 'invalid-end',
        message: EVENT_TIMING_MESSAGES['invalid-end'],
      };
    }
    endAt = istToInstant(date, endTime);
    if (endAt.getTime() <= startAt.getTime()) {
      return {
        ok: false,
        reason: 'end-before-start',
        message: EVENT_TIMING_MESSAGES['end-before-start'],
      };
    }
  }

  return { ok: true, startAt, endAt };
}

/** Window helper shared by `/digest`: a rolling `days`-day range ending at now. */
export function rollingWindow(now: Date, days: number): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - days * DAY_MS), to: new Date(now) };
}

export function isWithinWindow(
  instant: Date | string,
  from: Date,
  to: Date,
): boolean {
  const time =
    instant instanceof Date ? instant.getTime() : Date.parse(String(instant));
  return Number.isFinite(time) && time >= from.getTime() && time <= to.getTime();
}
