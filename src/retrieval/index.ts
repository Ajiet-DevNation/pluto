/**
 * Public retrieval entry point.
 *
 * The implementation lives in `src/search` so storage, indexing and retrieval
 * can share types without a circular dependency; this barrel keeps the
 * PR-PLAN's `src/retrieval` consumer surface stable.
 */

export * from '../search/retrieval';
export * from '../search/types';
