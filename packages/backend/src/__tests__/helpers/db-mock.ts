import { vi } from "vitest";

/**
 * Creates a fluent mock that mirrors Drizzle's query builder pattern:
 *   db.select({...}).from(table).where(...).innerJoin(...).orderBy(...).limit(n)
 *
 * Call `mockResolvedValue(rows)` on the returned object to set the result.
 */
export function createQueryChain(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get(_target, prop) {
      if (prop === "then") {
        // Make it thenable so `await` resolves to result
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      if (prop === "returning") {
        return vi.fn(() => Promise.resolve(result));
      }
      // Every other chained call (select, from, where, innerJoin, orderBy, limit, set, values, onConflictDoNothing)
      // returns itself so calls can be chained freely.
      return vi.fn(() => self);
    },
  });
  return self;
}

/**
 * Build a mock `db` object that can be spread into `vi.mock` factory.
 * Usage:
 *   const mockDb = createMockDb();
 *   vi.mock("../db/connection.js", () => ({ db: mockDb }));
 */
export function createMockDb() {
  return {
    query: new Proxy(
      {},
      {
        get() {
          return {
            findFirst: vi.fn(),
          };
        },
      }
    ),
    select: vi.fn(() => createQueryChain()),
    insert: vi.fn(() => createQueryChain()),
    update: vi.fn(() => createQueryChain()),
    delete: vi.fn(() => createQueryChain()),
  };
}
