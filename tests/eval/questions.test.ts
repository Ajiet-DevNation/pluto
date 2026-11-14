import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface EvalQuestion {
  id: string;
  category: string;
  question: string;
  repository: string | null;
  expect: string;
  must_include_any: string[];
  must_not_include: string[];
  verified: boolean;
}

const questions = JSON.parse(
  readFileSync(resolve(__dirname, 'questions.json'), 'utf8'),
) as EvalQuestion[];

const EXPECTS = ['answer', 'no-evidence', 'refuse-private', 'refuse-write'];
const CATEGORIES = [
  'readme', 'source-file', 'dependency', 'issue', 'pull-request', 'commit',
  'contributor', 'cross-repository', 'no-evidence', 'out-of-scope',
];

test('evaluation set has unique ids and valid fields', () => {
  const ids = new Set(questions.map((item) => item.id));
  assert.equal(ids.size, questions.length, 'ids must be unique');
  for (const item of questions) {
    assert.ok(EXPECTS.includes(item.expect), `${item.id}: unknown expect ${item.expect}`);
    assert.ok(CATEGORIES.includes(item.category), `${item.id}: unknown category ${item.category}`);
    assert.ok(item.question.trim().length > 0, `${item.id}: empty question`);
    if (item.expect === 'answer') {
      assert.ok(item.must_include_any.length > 0 || item.verified === false,
        `${item.id}: a verified answer entry needs an expected fact`);
    }
  }
});

test('every category is covered by at least one entry', () => {
  for (const category of CATEGORIES) {
    assert.ok(questions.some((item) => item.category === category), `missing category ${category}`);
  }
});
