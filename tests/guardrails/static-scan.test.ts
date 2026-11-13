import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Static half of the read-only enforcement.
 *
 * The guard proves writes cannot be reached through the exported interfaces.
 * This scan proves no write path was written into the client modules at all.
 */

const SCANNED_DIRECTORIES = ['src/github', 'src/miro'];

const FORBIDDEN: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: 'write method call',
    pattern: /\.(create|update|delete|remove|patch|post|put|merge|close|lock|archive)\s*\(/i,
  },
  {
    name: 'write HTTP verb',
    pattern: /method\s*:\s*['"](POST|PUT|PATCH|DELETE)['"]/i,
  },
  {
    name: 'write helper on an HTTP client',
    pattern: /\b(?:http|axios|octokit|rest)\.(?:post|put|patch|delete)\b/i,
  },
];

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else if (full.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

test('client modules contain no write operations', () => {
  const root = process.cwd();
  const violations: string[] = [];

  for (const directory of SCANNED_DIRECTORIES) {
    for (const file of walk(resolve(root, directory))) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');
      for (const rule of FORBIDDEN) {
        lines.forEach((line, index) => {
          if (rule.pattern.test(line)) {
            violations.push(`${relative(root, file)}:${index + 1} — ${rule.name}: ${line.trim()}`);
          }
        });
      }
    }
  }

  assert.deepEqual(violations, [], `Write operations found in read-only modules:\n${violations.join('\n')}`);
});

test('every request helper hardcodes GET', () => {
  const root = process.cwd();
  for (const directory of SCANNED_DIRECTORIES) {
    for (const file of walk(resolve(root, directory))) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('async function getJson')) continue;
      assert.match(
        source,
        /method:\s*'GET'/,
        `${relative(root, file)} defines getJson without a hardcoded GET`,
      );
      assert.doesNotMatch(
        source,
        /getJson<[^>]*>\([^)]*,\s*method/,
        `${relative(root, file)} passes an HTTP method into getJson`,
      );
    }
  }
});
