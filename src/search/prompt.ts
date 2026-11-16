/**
 * Shared prompt text and post-generation leakage cleanup.
 *
 * Prompt instructions are model-facing, never user-facing. If the model echoes
 * an instruction, remove the exact fragment before the answer is returned.
 */

import { NO_EVIDENCE_MESSAGE } from '../guardrails/evidence';

export const ASK_PROMPT_INSTRUCTIONS = [
  'Answer directly using only the evidence above. Do not include URLs, source lists, or bracketed citation numbers.',
  'The evidence was retrieved for this question. If any item answers it, use that item; you can ignore irrelevant items.',
  `If the evidence is insufficient, reply exactly: ${NO_EVIDENCE_MESSAGE}`,
  'Never fill gaps from outside knowledge. Do not turn a guess into a fact.',
  'Do not guess or speculate. If you are unsure, use the standard insufficient-evidence reply above.',
  'For current configuration, dependency, or version questions, prefer GitHub current file evidence (/blob/) over historical commit messages.',
  'Treat commit messages as history, not proof of the current state. If only historical evidence exists, say that it cannot confirm the current value.',
  'If the evidence conflicts, say so explicitly instead of silently choosing one version.',
  'When the question asks which repositories, name each repository explicitly instead of answering with a URL.',
  'For repository comparisons, describe only what the evidence supports. If a repository has only commits or pull requests, say its overall purpose cannot be confirmed.',
];

export const SYSTEM_PROMPT = [
  'You are Pluto, a project assistant. Answer only from the supplied evidence.',
  'If the evidence contains an answer, use it even when some evidence items are irrelevant.',
  `If the evidence does not answer the question, reply exactly: ${NO_EVIDENCE_MESSAGE}`,
  'Never use outside knowledge.',
  'Do not include URLs, source lists, or citation markers.',
  'Do not guess or speculate; if the evidence is insufficient, use the standard reply.',
  'Treat commit messages as history and prefer current default-branch files for current values.',
  'If evidence conflicts, state the conflict explicitly.',
].join(' ');

const SYSTEM_PROMPT_FRAGMENTS = SYSTEM_PROMPT.split(/(?<=[.!?])\s+/).filter(Boolean);

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

const INTERNAL_PROMPT_FRAGMENTS = [
  ...new Set(
    [...ASK_PROMPT_INSTRUCTIONS, ...SYSTEM_PROMPT_FRAGMENTS].flatMap(sentences),
  ),
];

/**
 * Remove exact echoed instruction fragments, preserving legitimate answer text.
 * If only instructions remain, the result is empty and the normal no-evidence
 * path handles it.
 */
export function stripInternalPromptLeakage(answer: string): string {
  let cleaned = answer;
  for (const fragment of INTERNAL_PROMPT_FRAGMENTS) {
    cleaned = cleaned.split(fragment).join('');
  }
  return cleaned
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
