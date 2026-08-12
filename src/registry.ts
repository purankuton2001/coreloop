// A registry resolves an id to a definition — and, when definitions own child
// items (a mode owning its flows, a session type owning its screens), resolves
// a child id to its owner. Both apps grew ad-hoc `find()` calls for this; one
// implementation keeps "unknown id" behaviour consistent.

export type RegistryOptions<T> = {
  /** Returned by get() for an unknown id. Useful for legacy rows written before ids existed. */
  defaultId?: string;
  /** Child ids owned by an item. Must be unique across the whole registry. */
  childIds?: (item: T) => readonly string[];
};

export type Registry<T> = {
  /** All items, in definition order. */
  all(): T[];
  /** Item by id, falling back to the default item (undefined if neither exists). */
  get(id: string | null | undefined): T | undefined;
  /** Item by id, throwing if it does not resolve. */
  require(id: string | null | undefined): T;
  /** True if this exact id is registered (ignores the default fallback). */
  has(id: string): boolean;
  /** The item owning this child id. */
  byChildId(childId: string): T | undefined;
  /** The child itself, when children are objects with ids. */
  childOf<C extends { id: string }>(owner: T, childId: string, children: (item: T) => readonly C[]): C | undefined;
};

export function createRegistry<T extends { id: string }>(
  items: readonly T[],
  options: RegistryOptions<T> = {},
): Registry<T> {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (byId.has(item.id)) {
      throw new Error(`coreloop: duplicate registry id "${item.id}"`);
    }
    byId.set(item.id, item);
  }

  const owners = new Map<string, T>();
  if (options.childIds) {
    for (const item of items) {
      for (const childId of options.childIds(item)) {
        const existing = owners.get(childId);
        if (existing && existing.id !== item.id) {
          throw new Error(
            `coreloop: child id "${childId}" is claimed by both "${existing.id}" and "${item.id}"`,
          );
        }
        owners.set(childId, item);
      }
    }
  }

  const fallback = options.defaultId != null ? byId.get(options.defaultId) : undefined;
  if (options.defaultId != null && !fallback) {
    throw new Error(`coreloop: defaultId "${options.defaultId}" is not registered`);
  }

  return {
    all: () => [...items],
    get: (id) => (id != null ? byId.get(id) : undefined) ?? fallback,
    require(id) {
      const found = this.get(id);
      if (!found) throw new Error(`coreloop: unknown id "${String(id)}"`);
      return found;
    },
    has: (id) => byId.has(id),
    byChildId: (childId) => owners.get(childId),
    childOf: (owner, childId, children) => children(owner).find((c) => c.id === childId),
  };
}
