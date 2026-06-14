/** Names written by database-schema.test.ts when it incorrectly used the live app DB. */
export const FIXTURE_COLLECTION_NAMES = new Set([
  'Test Collection',
  'Read Test',
  'Updated Name',
  'Request Test Collection',
  'Timestamp Test',
]);

export function isFixtureCollection(name: string): boolean {
  return FIXTURE_COLLECTION_NAMES.has(name);
}

/** Collections the user actually created — exclude vitest fixture rows. */
export function userCollections<T extends { name: string }>(cols: T[]): T[] {
  return cols.filter((c) => !isFixtureCollection(c.name));
}
