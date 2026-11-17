import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMeeting,
  MEETING_TIMEZONE,
  type ParseResult,
} from '../../src/meetings/parsing.js';

const ANCHOR = new Date('2026-11-14T10:00:00.000Z'); // Saturday, 15:30 Kolkata

function parse(content: string, now?: Date): ParseResult {
  return parseMeeting(content, ANCHOR, { now: () => now ?? new Date('2026-11-14T12:00:00.000Z') });
}

function assertOk(t: TestContext, content: string, expectedISO: string, now?: Date) {
  const parsed = parse(content, now);
  assert.equal(parsed.kind, 'ok', `expected ok for "${content}": ${parsed.clarification}`);
  assert.equal(parsed.timezone, MEETING_TIMEZONE);
  assert.equal(parsed.startAt!.toISOString(), expectedISO);
  return parsed;
}

// TestContext is provided by node:test; keep signature loose.
interface TestContext {}

test('Tomorrow at 4 PM -> next day 16:00 Asia/Kolkata (UTC 10:30)', () => {
  assertOk(null as unknown as TestContext, 'Tomorrow at 4 PM', '2026-11-15T10:30:00.000Z');
});

test('Friday at 10:30 AM -> next Friday 10:30 Asia/Kolkata (UTC 05:00)', () => {
  assertOk(null as unknown as TestContext, 'Friday at 10:30 AM', '2026-11-20T05:00:00.000Z');
});

test('18 November at 3 PM -> 18 November 15:00 Asia/Kolkata (UTC 09:30)', () => {
  assertOk(null as unknown as TestContext, '18 November at 3 PM', '2026-11-18T09:30:00.000Z');
});

test('18/11 at 15:00 -> day-first 18 November 15:00 (24-hour)', () => {
  assertOk(null as unknown as TestContext, '18/11 at 15:00', '2026-11-18T09:30:00.000Z');
});

test('November 18, 2026 at 10:30 -> HH:MM is 24-hour, 10:30 Asia/Kolkata', () => {
  assertOk(null as unknown as TestContext, 'November 18, 2026 at 10:30', '2026-11-18T05:00:00.000Z');
});

test('Today at 5 -> ambiguous bare hour (05:00 or 17:00)', () => {
  const parsed = parse('Today at 5');
  assert.equal(parsed.kind, 'clarify');
  assert.ok(parsed.clarification!.includes('05:00') && parsed.clarification!.includes('17:00'));
});

test('25:00 -> invalid time', () => {
  const parsed = parse('Today at 25:00');
  assert.equal(parsed.kind, 'clarify');
  assert.ok(/time/.test(parsed.clarification!));
});

test('missing date -> asks for date', () => {
  const parsed = parse('at 4 PM');
  assert.equal(parsed.kind, 'clarify');
  assert.ok(/date/.test(parsed.clarification!));
});

test('missing time -> asks for time', () => {
  const parsed = parse('Tomorrow');
  assert.equal(parsed.kind, 'clarify');
  assert.ok(/time/.test(parsed.clarification!));
});

test('ambiguous numeric date 05/06 -> asks to clarify order', () => {
  const parsed = parse('05/06 at 10:00');
  assert.equal(parsed.kind, 'clarify');
  assert.ok(/ambiguous/.test(parsed.clarification!));
});

test('past date/time -> asks for clarification', () => {
  const now = new Date('2026-11-14T12:00:00.000Z'); // noon UTC = 17:30 Kolkata
  // "Today at 10 AM" = Kolkata 10:00 = UTC 04:30, already past at noon UTC
  const parsed = parse('Today at 10 AM', now);
  assert.equal(parsed.kind, 'clarify');
});

test('timezone conversion: Kolkata 15:00 = UTC 09:30', () => {
  const parsed = parse('18 November at 3 PM');
  assert.equal(parsed.kind, 'ok');
  // Kolkata 15:00 -> UTC 09:30
  assert.equal(parsed.startAt!.getUTCHours(), 9);
  assert.equal(parsed.startAt!.getUTCMinutes(), 30);
});

test('relative date anchored to createdAt not processing time', () => {
  // The date resolves from the announcement createdAt (Nov 14) -> tomorrow
  // Nov 15, independent of when the job is processed. With now at Nov 14 noon
  // UTC, Nov 15 10:30 UTC is still in the future.
  const parsed = parse('Tomorrow at 4 PM');
  assert.equal(parsed.kind, 'ok');
  assert.equal(parsed.startAt!.toISOString(), '2026-11-15T10:30:00.000Z');
});

test('meeting less than one hour away is still ok', () => {
  // Anchor 15:30 Kolkata; "Today at 15:45" = 15 min away, future.
  const now = new Date('2026-11-14T10:00:00.000Z'); // UTC = 15:30 Kolkata
  const parsed = parse('Today at 15:45', now);
  assert.equal(parsed.kind, 'ok');
  assert.equal(parsed.startAt!.toISOString(), '2026-11-14T10:15:00.000Z');
});

test('day after tomorrow resolves correctly', () => {
  assertOk(null as unknown as TestContext, 'Day after tomorrow at 9 AM', '2026-11-16T03:30:00.000Z');
});

test('weekday that is the message day is ambiguous', () => {
  // Anchor Nov 14 2026 is a Saturday.
  const parsed = parse('Saturday at 10 AM');
  assert.equal(parsed.kind, 'clarify');
  assert.ok(/ambiguous/.test(parsed.clarification!));
});
