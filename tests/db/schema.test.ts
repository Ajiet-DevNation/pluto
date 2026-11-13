import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as schema from '../../src/db/schema.js';

describe('database schema', () => {
  it('defines repositories table', () => {
    assert.ok(schema.repositories);
    assert.ok(schema.repositories.name);
    assert.ok(schema.repositories.githubId);
    assert.ok(schema.repositories.fullName);
    assert.ok(schema.repositories.owner);
    assert.ok(schema.repositories.htmlUrl);
  });

  it('defines issues table with repository reference', () => {
    assert.ok(schema.issues);
    assert.ok(schema.issues.githubId);
    assert.ok(schema.issues.repositoryId);
    assert.ok(schema.issues.title);
    assert.ok(schema.issues.body);
    assert.ok(schema.issues.state);
    assert.ok(schema.issues.htmlUrl);
    assert.ok(schema.issues.createdAt);
    assert.ok(schema.issues.updatedAt);
  });
});
