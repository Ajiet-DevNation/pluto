import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFullTextQuery,
  dedupeChunksByContent,
  sourceReferencesFromQuestion,
} from '../../src/search/query';
import {
  DEFAULT_IVFFLAT_PROBES,
  ivfflatProbesFromEnv,
} from '../../src/search/postgres';

test('full-text query drops question words and keeps the subject', () => {
  const built = buildFullTextQuery('What is Pluto?');
  assert.deepEqual(built.terms, ['pluto']);
  assert.equal(built.strictText, '(pluto)');
  assert.equal(built.broadText, '(pluto)');
});

test('full-text query strips the repository and organization qualifiers', () => {
  const built = buildFullTextQuery(
    'In Ajiet-DevNation/pluto, which embedding model does search use?',
    'Ajiet-DevNation/pluto',
    'Ajiet-DevNation',
  );
  assert.deepEqual(built.terms, ['embedding', 'model', 'search']);
  assert.doesNotMatch(built.cleaned, /ajiet|pluto/i);
});

test('full-text query strips a cross-repository organization token', () => {
  const built = buildFullTextQuery(
    'Which repositories in Ajiet-DevNation use Next.js?',
    undefined,
    'Ajiet-DevNation',
  );
  assert.deepEqual(built.terms, ['next.js']);
  assert.match(built.broadText, /next\.js \| next \| js/);
});

test('full-text query expands dotted and underscored identifiers', () => {
  const built = buildFullTextQuery('search_chunks tsvector migration');
  assert.deepEqual(built.terms, ['search_chunks', 'tsvector', 'migration']);
  assert.match(built.groups[0], /search_chunks \| search \| chunks/);
  assert.equal(built.groups.length, 3);
  assert.match(built.strictText, / & /);
  assert.match(built.broadText, / \| /);
});

test('full-text query cannot be injected with tsquery operators', () => {
  const built = buildFullTextQuery(`Pluto's OR ! data & "secret"`);
  assert.doesNotMatch(built.broadText, /['"!]/);
  assert.doesNotMatch(built.terms.join(' '), /['"!&]/);
});

test('source references resolve issue, pull request and commit ids', () => {
  assert.deepEqual(
    sourceReferencesFromQuestion(
      'What does pull request #12 in Ajiet-DevNation/pluto change?',
      'Ajiet-DevNation/pluto',
    ),
    ['Ajiet-DevNation/pluto#pr-12'],
  );
  assert.deepEqual(
    sourceReferencesFromQuestion('Summarize issue #99999.', 'Ajiet-DevNation/pluto'),
    ['Ajiet-DevNation/pluto#99999'],
  );
  assert.deepEqual(
    sourceReferencesFromQuestion('Explain commit d7d9f3d6110f118b.', 'Ajiet-DevNation/pluto'),
    ['Ajiet-DevNation/pluto@d7d9f3d6110f118b'],
  );
});

test('source references are not guessed without a repository', () => {
  assert.deepEqual(sourceReferencesFromQuestion('What does PR #12 change?'), []);
  assert.deepEqual(sourceReferencesFromQuestion('What does PR #12 change?', 'pluto.'), [
    'pluto#pr-12',
  ]);
});

test('duplicate content is removed while the highest score wins', () => {
  const deduped = dedupeChunksByContent([
    { content: 'Same   text', score: 0.4 },
    { content: 'same text', score: 0.9 },
    { content: 'Different text', score: 0.5 },
  ]);
  assert.deepEqual(
    deduped.map((chunk) => [chunk.content, chunk.score]),
    [
      ['same text', 0.9],
      ['Different text', 0.5],
    ],
  );
});

test('IVFFlat probes default to the measured exact configuration', () => {
  assert.equal(DEFAULT_IVFFLAT_PROBES, 100);
  assert.equal(ivfflatProbesFromEnv({}), 100);
  assert.equal(ivfflatProbesFromEnv({ IVFFLAT_PROBES: '64' }), 64);
  assert.throws(() => ivfflatProbesFromEnv({ IVFFLAT_PROBES: '0' }), /between 1 and 32768/);
  assert.throws(() => ivfflatProbesFromEnv({ IVFFLAT_PROBES: 'ten' }), /between 1 and 32768/);
});
