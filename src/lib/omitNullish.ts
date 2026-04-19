/**
 * Build MongoDB `$set` payload: omit keys whose values are `null` or `undefined`
 * so existing values in the database are not overwritten.
 * Nested `source_ids` is flattened one level the same way.
 */
export function omitNullUndefinedForSet(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (k === "source_ids" && typeof v === "object" && v !== null && !Array.isArray(v)) {
      const sid: Record<string, unknown> = {};
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        if (sv !== null && sv !== undefined) sid[sk] = sv;
      }
      if (Object.keys(sid).length > 0) out[k] = sid;
      continue;
    }
    out[k] = v;
  }
  return out;
}
