import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatIstDate,
  formatIstDateTime,
  formatIstDateTimeCompact,
  formatIstRange,
  formatIstTime,
  instantToIst,
  isWithinWindow,
  istToInstant,
  parseCalendarDate,
  parseClockTime,
  parseClockTimeInput,
  resolveEventTiming,
  rollingWindow,
} from '../../src/events/time';

const NOW = new Date('2026-11-18T06:30:00.000Z'); // 12:00 IST

test('strict YYYY-MM-DD parsing accepts real dates only', () => {
  assert.deepEqual(parseCalendarDate('2026-11-22'), {
    year: 2026,
    month: 11,
    day: 22,
  });
  assert.deepEqual(parseCalendarDate(' 2024-02-29 '), {
    year: 2024,
    month: 2,
    day: 29,
  });
  assert.equal(parseCalendarDate('2026-02-30'), null);
  assert.equal(parseCalendarDate('2026-13-01'), null);
  assert.equal(parseCalendarDate('2026-00-10'), null);
  assert.equal(parseCalendarDate('2026-1-1'), null);
  assert.equal(parseCalendarDate('22-11-2026'), null);
  assert.equal(parseCalendarDate('2026-11-22T10:00'), null);
  assert.equal(parseCalendarDate(''), null);
});

test('strict HH:MM parsing rejects non-24-hour input', () => {
  assert.deepEqual(parseClockTime('00:00'), { hour: 0, minute: 0 });
  assert.deepEqual(parseClockTime('09:05'), { hour: 9, minute: 5 });
  assert.deepEqual(parseClockTime('23:59'), { hour: 23, minute: 59 });
  assert.equal(parseClockTime('24:00'), null);
  assert.equal(parseClockTime('9:00'), null);
  assert.equal(parseClockTime('10:60'), null);
  assert.equal(parseClockTime('10'), null);
  assert.equal(parseClockTime('10:00:00'), null);
});

test('12-hour input accepts AM/PM with or without spaces and dots', () => {
  assert.deepEqual(parseClockTimeInput('10:00'), { hour: 10, minute: 0 });
  assert.deepEqual(parseClockTimeInput('16:30'), { hour: 16, minute: 30 });
  assert.deepEqual(parseClockTimeInput('10:00 AM'), { hour: 10, minute: 0 });
  assert.deepEqual(parseClockTimeInput('10:00AM'), { hour: 10, minute: 0 });
  assert.deepEqual(parseClockTimeInput('4:30 PM'), { hour: 16, minute: 30 });
  assert.deepEqual(parseClockTimeInput('4:30pm'), { hour: 16, minute: 30 });
  assert.deepEqual(parseClockTimeInput('4:30 p.m.'), { hour: 16, minute: 30 });
  assert.deepEqual(parseClockTimeInput('4 PM'), { hour: 16, minute: 0 });
  assert.deepEqual(parseClockTimeInput('4PM'), { hour: 16, minute: 0 });
  assert.deepEqual(parseClockTimeInput('12:00 AM'), { hour: 0, minute: 0 });
  assert.deepEqual(parseClockTimeInput('12:00 PM'), { hour: 12, minute: 0 });
  assert.deepEqual(parseClockTimeInput('12 AM'), { hour: 0, minute: 0 });
  assert.deepEqual(parseClockTimeInput('12 PM'), { hour: 12, minute: 0 });
  assert.deepEqual(parseClockTimeInput('1:05 PM'), { hour: 13, minute: 5 });
  assert.deepEqual(parseClockTimeInput('11:59 PM'), { hour: 23, minute: 59 });

  assert.equal(parseClockTimeInput('0:30 AM'), null);
  assert.equal(parseClockTimeInput('13:00 PM'), null);
  assert.equal(parseClockTimeInput('13:00 AM'), null);
  assert.equal(parseClockTimeInput('10:00 XM'), null);
  assert.equal(parseClockTimeInput('10:60 PM'), null);
  assert.equal(parseClockTimeInput('4:00'), null);
  assert.equal(parseClockTimeInput(''), null);
});

test('Asia/Kolkata is converted with the fixed +05:30 offset', () => {
  const instant = istToInstant(
    { year: 2026, month: 11, day: 22 },
    { hour: 10, minute: 0 },
  );
  assert.equal(instant.toISOString(), '2026-11-22T04:30:00.000Z');

  assert.deepEqual(instantToIst(instant), {
    year: 2026,
    month: 11,
    day: 22,
    hour: 10,
    minute: 0,
    weekday: 0,
  });
});

test('IST display is deterministic, explicit and 12-hour', () => {
  const instant = new Date('2026-11-22T04:30:00.000Z');
  assert.equal(formatIstTime(instant), '10:00 AM');
  assert.equal(formatIstDateTime(instant), 'Sun, 22 Nov 2026, 10:00 AM IST');
  assert.equal(
    formatIstDateTimeCompact(instant),
    '22 Nov 2026, 10:00 AM IST',
  );
  assert.equal(formatIstDate(instant), '22 Nov 2026');
  assert.equal(
    formatIstRange(instant, new Date('2026-11-22T06:30:00.000Z')),
    'Sun, 22 Nov 2026, 10:00 AM–12:00 PM IST',
  );
  assert.equal(
    formatIstRange(instant, null),
    'Sun, 22 Nov 2026, 10:00 AM IST',
  );
  assert.equal(
    formatIstRange(instant, new Date('2026-11-23T04:30:00.000Z')),
    'Sun, 22 Nov 2026, 10:00 AM IST – Mon, 23 Nov 2026, 10:00 AM IST',
  );
  assert.equal(
    formatIstTime(new Date('2026-11-21T18:30:00.000Z')),
    '12:00 AM',
  );
  assert.equal(
    formatIstTime(new Date('2026-11-22T06:30:00.000Z')),
    '12:00 PM',
  );
  assert.equal(
    formatIstTime(new Date('2026-11-22T12:45:00.000Z')),
    '6:15 PM',
  );
  assert.equal(
    formatIstTime(new Date('2026-11-22T03:35:00.000Z')),
    '9:05 AM',
  );
});

test('event timing requires a real future start', () => {
  const past = resolveEventTiming(
    { date: '2026-11-18', time: '12:00' },
    NOW,
  );
  assert.equal(past.ok, false);
  if (!past.ok) assert.equal(past.reason, 'past');

  const future = resolveEventTiming(
    { date: '2026-11-18', time: '12:01' },
    NOW,
  );
  assert.equal(future.ok, true);
  if (future.ok) {
    assert.equal(future.startAt.toISOString(), '2026-11-18T06:31:00.000Z');
    assert.equal(future.endAt, null);
  }

  const twelveHour = resolveEventTiming(
    { date: '2026-11-22', time: '4:30 PM', end: '6:00 PM' },
    NOW,
  );
  assert.equal(twelveHour.ok, true);
  if (twelveHour.ok) {
    assert.equal(twelveHour.startAt.toISOString(), '2026-11-22T11:00:00.000Z');
    assert.equal(twelveHour.endAt?.toISOString(), '2026-11-22T12:30:00.000Z');
  }

  const noon = resolveEventTiming(
    { date: '2026-11-22', time: '12:00 PM' },
    NOW,
  );
  assert.equal(noon.ok, true);
  if (noon.ok) {
    assert.equal(noon.startAt.toISOString(), '2026-11-22T06:30:00.000Z');
  }

  const midnight = resolveEventTiming(
    { date: '2026-11-23', time: '12:00 AM' },
    NOW,
  );
  assert.equal(midnight.ok, true);
  if (midnight.ok) {
    assert.equal(midnight.startAt.toISOString(), '2026-11-22T18:30:00.000Z');
  }

  const invalidDate = resolveEventTiming(
    { date: '2026-02-30', time: '10:00' },
    NOW,
  );
  assert.equal(invalidDate.ok, false);
  if (!invalidDate.ok) assert.equal(invalidDate.reason, 'invalid-date');

  const invalidTime = resolveEventTiming(
    { date: '2026-11-22', time: '9:00' },
    NOW,
  );
  assert.equal(invalidTime.ok, false);
  if (!invalidTime.ok) assert.equal(invalidTime.reason, 'invalid-time');
});

test('optional end time must be a valid time after the start on the same date', () => {
  const valid = resolveEventTiming(
    { date: '2026-11-22', time: '10:00', end: '12:30' },
    NOW,
  );
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.startAt.toISOString(), '2026-11-22T04:30:00.000Z');
    assert.equal(valid.endAt?.toISOString(), '2026-11-22T07:00:00.000Z');
  }

  const before = resolveEventTiming(
    { date: '2026-11-22', time: '10:00', end: '09:00' },
    NOW,
  );
  assert.equal(before.ok, false);
  if (!before.ok) assert.equal(before.reason, 'end-before-start');

  const equal = resolveEventTiming(
    { date: '2026-11-22', time: '10:00', end: '10:00' },
    NOW,
  );
  assert.equal(equal.ok, false);
  if (!equal.ok) assert.equal(equal.reason, 'end-before-start');

  const badEnd = resolveEventTiming(
    { date: '2026-11-22', time: '10:00', end: '25:00' },
    NOW,
  );
  assert.equal(badEnd.ok, false);
  if (!badEnd.ok) assert.equal(badEnd.reason, 'invalid-end');

  const badEndMeridiem = resolveEventTiming(
    { date: '2026-11-22', time: '10:00 AM', end: '13:00 PM' },
    NOW,
  );
  assert.equal(badEndMeridiem.ok, false);
  if (!badEndMeridiem.ok) assert.equal(badEndMeridiem.reason, 'invalid-end');
});

test('rolling window and date-string membership are inclusive', () => {
  const { from, to } = rollingWindow(NOW, 7);
  assert.equal(from.toISOString(), '2026-11-11T06:30:00.000Z');
  assert.equal(to.toISOString(), NOW.toISOString());
  assert.equal(isWithinWindow(from, from, to), true);
  assert.equal(isWithinWindow(to, from, to), true);
  assert.equal(
    isWithinWindow('2026-11-11T06:29:59.999Z', from, to),
    false,
  );
  assert.equal(isWithinWindow('not-a-date', from, to), false);
});
