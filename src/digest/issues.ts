/**
 * Read-only GitHub issue counts for `/digest`.
 *
 * Only fields with reliable occurrence dates are used. Pull requests and
 * commits are deliberately not counted: the current corpus does not store a
 * reliable occurrence date for them.
 */

import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../db/index';
import { issues, repositories } from '../db/schema';

export interface DigestIssue {
  githubId: number;
  number: number;
  title: string;
  htmlUrl: string;
  repositoryFullName: string;
  createdAt: Date;
}

export async function listIssuesCreatedBetween(
  db: Db,
  from: Date,
  to: Date,
): Promise<DigestIssue[]> {
  return db
    .select({
      githubId: issues.githubId,
      number: issues.number,
      title: issues.title,
      htmlUrl: issues.htmlUrl,
      repositoryFullName: repositories.fullName,
      createdAt: issues.createdAt,
    })
    .from(issues)
    .innerJoin(repositories, eq(issues.repositoryId, repositories.id))
    .where(and(gte(issues.createdAt, from), lte(issues.createdAt, to)))
    .orderBy(desc(issues.createdAt), desc(issues.githubId));
}
