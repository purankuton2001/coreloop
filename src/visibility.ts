// What a public page is allowed to contain.
//
// Same discipline as toClientFlow: the server decides what leaves, and it
// decides by removing fields rather than by trusting each render site to skip
// them. A field is public only if the policy knows about it AND the person
// turned it on — an unknown field is dropped, so adding a column to a record
// cannot quietly publish it.

export type VisibilityFieldOptions = {
  /** Default when the person has never touched the setting. Default: false. */
  defaultVisible?: boolean;
  /** Always published regardless of settings (a display name, a handle). */
  always?: boolean;
};

export type VisibilityPolicy<K extends string> = {
  fields: readonly K[];
  /** Settings object with every field at its default. */
  defaults(): Record<K, boolean>;
  /** Fill in missing/invalid entries from the defaults. */
  resolve(settings: Partial<Record<K, boolean>> | null | undefined): Record<K, boolean>;
  isVisible(field: K, settings: Partial<Record<K, boolean>> | null | undefined): boolean;
  /**
   * Keep only the entries whose field is visible. Keys absent from the policy
   * are dropped: publishing is opt-in, including for fields added later.
   */
  apply<T extends Partial<Record<K, unknown>>>(
    data: T,
    settings: Partial<Record<K, boolean>> | null | undefined,
  ): Partial<T>;
};

export function defineVisibilityPolicy<K extends string>(
  fields: Record<K, VisibilityFieldOptions>,
): VisibilityPolicy<K> {
  const keys = Object.keys(fields) as K[];

  const defaults = () =>
    Object.fromEntries(
      keys.map((k) => [k, fields[k].always === true || fields[k].defaultVisible === true]),
    ) as Record<K, boolean>;

  const resolve = (settings: Partial<Record<K, boolean>> | null | undefined) =>
    Object.fromEntries(
      keys.map((k) => {
        if (fields[k].always === true) return [k, true];
        const value = settings?.[k];
        return [k, typeof value === "boolean" ? value : fields[k].defaultVisible === true];
      }),
    ) as Record<K, boolean>;

  const isVisible = (field: K, settings: Partial<Record<K, boolean>> | null | undefined) =>
    resolve(settings)[field] === true;

  return {
    fields: keys,
    defaults,
    resolve,
    isVisible,
    apply(data, settings) {
      const visible = resolve(settings);
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(data)) {
        if ((keys as string[]).includes(key) && visible[key as K]) {
          out[key] = data[key as keyof typeof data];
        }
      }
      return out as Partial<typeof data>;
    },
  };
}
