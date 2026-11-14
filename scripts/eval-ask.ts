#!/usr/bin/env tsx
/**
 * Runs the /ask evaluation set through the live AskService.
 *
 * Verified entries gate the exit code; unverified entries are reported only.
 * See .planning/contracts/evaluation.md for the pass criteria.
 */

import dotenv from 'dotenv';
dotenv.config();

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NO_EVIDENCE_MESSAGE } from '../src/guardrails/evidence';
import { createSearchRuntimeFromEnv } from '../src/search/runtime';

type Expect = 'answer' | 'no-evidence' | 'refuse-private';

interface EvalQuestion {
  id: string;
  category: string;
  question: string;
  repository: string | null;
  expect: Expect;
  must_include_any: string[];
  must_not_include: string[];
  verified: boolean;
}

interface EvalResult {
  id: string;
  category: string;
  verified: boolean;
  pass: boolean;
  reasons: string[];
  answer: string;
}

const CITATION_LEAK = /https?:\/\/|Sources:|\[\d+\]/i;

function evaluate(question: EvalQuestion, answer: string, ok: boolean): EvalResult {
  const reasons: string[] = [];
  const lower = answer.toLowerCase();

  if (question.expect === 'no-evidence') {
    if (answer !== NO_EVIDENCE_MESSAGE) reasons.push('expected the standard no-evidence message');
  } else if (question.expect === 'refuse-private') {
    if (ok) reasons.push('answered a private-repository request');
  } else {
    if (!ok) reasons.push('returned no-evidence for an answerable question');
    if (question.must_include_any.length > 0 &&
      !question.must_include_any.some((fact) => lower.includes(fact.toLowerCase()))) {
      reasons.push(`none of the expected facts appeared: ${question.must_include_any.join(', ')}`);
    }
  }

  for (const forbidden of question.must_not_include) {
    if (lower.includes(forbidden.toLowerCase())) reasons.push(`forbidden text present: ${forbidden}`);
  }

  if (CITATION_LEAK.test(answer)) reasons.push('answer shows a link, source list, or citation marker');

  return {
    id: question.id,
    category: question.category,
    verified: question.verified,
    pass: reasons.length === 0,
    reasons,
    answer,
  };
}

async function main(): Promise<void> {
  const runtime = createSearchRuntimeFromEnv();
  if (!runtime) {
    throw new Error('Search is not configured; set DATABASE_URL and Cloudflare credentials');
  }

  const questions = JSON.parse(
    readFileSync(resolve(process.cwd(), 'tests/eval/questions.json'), 'utf8'),
  ) as EvalQuestion[];

  const results: EvalResult[] = [];
  for (const question of questions) {
    const scopedQuestion = question.repository && !question.question.includes(question.repository)
      ? `${question.question} (repository: ${question.repository})`
      : question.question;
    try {
      const result = await runtime.askService.ask(scopedQuestion);
      const answer = result.ok ? result.answer : result.message;
      results.push(evaluate(question, answer, result.ok));
    } catch (error) {
      results.push({
        id: question.id,
        category: question.category,
        verified: question.verified,
        pass: false,
        reasons: [`threw: ${error instanceof Error ? error.message : String(error)}`],
        answer: '',
      });
    }
  }

  const byCategory = new Map<string, { passed: number; total: number }>();
  for (const result of results) {
    const entry = byCategory.get(result.category) ?? { passed: 0, total: 0 };
    entry.total += 1;
    if (result.pass) entry.passed += 1;
    byCategory.set(result.category, entry);
  }

  const verifiedFailures = results.filter((result) => result.verified && !result.pass);
  const unverifiedFailures = results.filter((result) => !result.verified && !result.pass);

  const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((result) => result.pass).length,
    verifiedFailures: verifiedFailures.map((result) => result.id),
    unverifiedFailures: unverifiedFailures.map((result) => result.id),
    categories: Object.fromEntries(byCategory),
    results,
  };

  const reportPath = resolve(process.cwd(), 'tmp/eval-ask-report.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  for (const [category, { passed, total }] of byCategory) {
    console.log(`${category}: ${passed}/${total}`);
  }
  console.log(`Total: ${report.passed}/${report.total} passed`);
  console.log(`Verified failures (gate): ${verifiedFailures.length}`);
  console.log(`Unverified failures (informational): ${unverifiedFailures.length}`);
  console.log(`Report: ${reportPath}`);

  if (verifiedFailures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Eval failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
