import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadOnlyGuard, ReadOnlyViolation } from '../../src/guardrails/read-only';

interface SampleClient {
  read: () => string;
  write: () => string;
}

function build() {
  const guard = createReadOnlyGuard<SampleClient>(['read'], { context: 'TestReader' });
  return guard({
    read: () => 'ok',
    write: () => 'should never run',
  });
}

test('allows an allowlisted read method', () => {
  assert.equal(build().read(), 'ok');
});

test('throws ReadOnlyViolation for a write method', () => {
  const client = build();
  assert.throws(
    () => (client as unknown as SampleClient).write(),
    (error: unknown) => {
      assert.ok(error instanceof ReadOnlyViolation);
      assert.equal(error.attempted, 'write');
      assert.match(error.message, /TestReader/);
      return true;
    },
  );
});

test('throws for an unknown property instead of returning undefined', () => {
  const client = build();
  assert.throws(() => (client as Record<string, unknown>)['createIssue'], ReadOnlyViolation);
});

test('throws on property assignment', () => {
  const client = build();
  assert.throws(() => {
    (client as unknown as Record<string, unknown>)['read'] = () => 'replaced';
  }, ReadOnlyViolation);
});

test('throws on property deletion', () => {
  const client = build();
  assert.throws(() => {
    delete (client as unknown as Record<string, unknown>)['read'];
  }, ReadOnlyViolation);
});

test('passes through symbols so runtime introspection does not throw', () => {
  const client = build();
  assert.doesNotThrow(() => Object.prototype.toString.call(client));
});

test('passes through "then" so the client is not mistaken for a thenable', () => {
  const client = build();
  assert.equal((client as unknown as Record<string, unknown>)['then'], undefined);
});

test('keeps method `this` bound to the raw target', () => {
  interface Counter {
    hits: number;
    read: () => number;
  }
  const guard = createReadOnlyGuard<Counter>(['read']);
  const raw: Counter = {
    hits: 0,
    read() {
      this.hits += 1;
      return this.hits;
    },
  };
  const guarded = guard(raw);
  assert.equal(guarded.read(), 1);
  assert.equal(raw.hits, 1);
});
