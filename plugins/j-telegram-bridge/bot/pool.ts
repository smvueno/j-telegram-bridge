/** Which running Claude to close so a new one fits under the limit: the quiet one used longest ago. */
export function pickEvict(
  entries: Array<{ key: string; lastUsed: number; busy: boolean }>,
  max: number,
): string | undefined {
  if (entries.length < max) return undefined;
  const idle = entries.filter((e) => !e.busy).sort((a, b) => a.lastUsed - b.lastUsed);
  return idle[0]?.key;
}
