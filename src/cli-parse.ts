/** Parse id list: "3,7,12" or "3 7 12" */
export function parseOnlyMessageIds(s: string | undefined): Set<number> | undefined {
  if (s == null || !String(s).trim()) return undefined;
  const ids = String(s)
    .split(/[\s,;]+/)
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => !Number.isNaN(n));
  if (ids.length === 0) return undefined;
  return new Set(ids);
}
