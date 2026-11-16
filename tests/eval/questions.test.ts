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
  must_include_all?: string[];
  must_not_include: string[];
  verified: boolean;
  expected_source_any?: string[];
  required_source_any?: string[];
  expect_structured_contributors?: boolean;
  required_version_claims?: Array<{ technology: string; major?: number; version?: string }>;
}

const questions = JSON.parse(
  readFileSync(resolve(__dirname, 'questions.json'), 'utf8'),
) as EvalQuestion[];

const EXPECTS = ['answer', 'no-evidence', 'refuse-private', 'refuse-write', 'uncertainty'];
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
      // An answer entry must verify something: any/all facts, a structured
      // contributor answer, or a version-aware claim. An empty expectation
      // would let any non-empty answer pass.
      assert.ok(
        item.must_include_any.length > 0 ||
          (item.must_include_all?.length ?? 0) > 0 ||
          item.expect_structured_contributors === true ||
          (item.required_version_claims?.length ?? 0) > 0,
        `${item.id}: an answer entry needs an expected fact, version claim, or structured evidence`,
      );
    }

    for (const field of ['expected_source_any', 'required_source_any', 'must_include_all'] as const) {
      const values = item[field];
      if (values === undefined) continue;
      assert.ok(Array.isArray(values), `${item.id}: ${field} must be an array`);
      for (const value of values) {
        assert.ok(typeof value === 'string' && value.length > 0,
          `${item.id}: ${field} entries must be non-empty strings`);
      }
    }
    if (item.required_version_claims !== undefined) {
      assert.ok(Array.isArray(item.required_version_claims),
        `${item.id}: required_version_claims must be an array`);
      for (const claim of item.required_version_claims) {
        assert.ok(typeof claim.technology === 'string' && claim.technology.length > 0,
          `${item.id}: a version claim needs a technology`);
        assert.ok(
          (typeof claim.major === 'number' && Number.isFinite(claim.major)) ||
            (typeof claim.version === 'string' && claim.version.length > 0),
          `${item.id}: a version claim needs major or version`,
        );
      }
    }
    if (item.expect_structured_contributors !== undefined) {
      assert.equal(typeof item.expect_structured_contributors, 'boolean',
        `${item.id}: expect_structured_contributors must be boolean`);
    }
  }
});

test('every category is covered by at least one entry', () => {
  for (const category of CATEGORIES) {
    assert.ok(questions.some((item) => item.category === category), `missing category ${category}`);
  }
});
