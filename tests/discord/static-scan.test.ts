import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SCANNED_DIRECTORIES = ['src/discord', 'src/optout'];

function walk(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else if (full.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

function sourceFiles(): Array<{ file: string; source: string }> {
  const root = process.cwd();
  return SCANNED_DIRECTORIES.flatMap((directory) =>
    walk(resolve(root, directory)).map((file) => ({
      file: relative(root, file),
      source: readFileSync(file, 'utf8'),
    })),
  );
}

test('Discord and opt-out modules never consult the exclusion list', () => {
  const forbidden = [
    /getExcludedChannels\s*\(/,
    /\.excluded_channels\b/,
    /\[\s*['"]excluded_channels['"]\s*\]/,
  ];
  const violations: string[] = [];

  for (const { file, source } of sourceFiles()) {
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${file} matches ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, [], violations.join('\n'));
});

test('commands are never registered at global application scope', () => {
  const forbidden = [/applicationCommands/, /\.application\.commands\b/];
  const violations: string[] = [];

  for (const { file, source } of sourceFiles()) {
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${file} matches ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, [], violations.join('\n'));
});

test('the bot never edits or deletes Discord history', () => {
  const forbidden = [
    /messages\.edit\s*\(/,
    /messages\.delete\s*\(/,
    /message\.edit\s*\(/,
    /message\.delete\s*\(/,
    /bulkDelete\s*\(/,
    /WebhookClient/,
    /webhookId/,
  ];
  const violations: string[] = [];

  for (const { file, source } of sourceFiles()) {
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${file} matches ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, [], violations.join('\n'));
});

test('registration is wired to the guild command manager, not a global route', () => {
  const botSource = readFileSync(
    resolve(process.cwd(), 'src/discord/bot.ts'),
    'utf8',
  );
  const commandSource = readFileSync(
    resolve(process.cwd(), 'src/discord/commands.ts'),
    'utf8',
  );

  assert.match(botSource, /guild\.commands\.set\(/);
  assert.match(commandSource, /manager\.set\(/);
});
