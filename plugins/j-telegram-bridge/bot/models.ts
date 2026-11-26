/** Models offered as buttons by /model. Fable is left out: on Pro/Max plans it needs extra usage credits. */
export const MODEL_CHOICES = ["sonnet", "opus", "haiku"] as const;

/** Same short descriptions as the Claude app's model picker. */
export const MODEL_INFO: Record<string, string> = {
  opus: "For complex work and everyday tasks",
  sonnet: "Most efficient for simpler tasks",
  haiku: "Fastest for quick answers",
  fable: "For your toughest challenges (needs usage credits)",
};

/** Thinking levels claude accepts as --effort. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

const EFFORT_WORDS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** Accepts an alias (any case) or a full model id like claude-sonnet-5-5. Returns null for anything else. */
export function normalizeModel(input: string): string | null {
  const v = input.trim().toLowerCase();
  if (/^(sonnet|opus|haiku|fable)$/.test(v)) return v;
  if (/^claude-[a-z0-9.\-]+(\[[a-z0-9=,]+\])?$/.test(v)) return v;
  return null;
}

/** "Extra high", "extra-high", "xhigh", "Medium" -> the level; null for anything else. */
export function normalizeEffort(input: string): string | null {
  const v = input.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (v === "extrahigh") return "xhigh";
  return (EFFORT_LEVELS as readonly string[]).includes(v) ? v : null;
}

export function effortLabel(level: string): string {
  return EFFORT_WORDS[level] ?? level;
}

/** "claude-sonnet-5-5" -> "Sonnet 5.5"; null when it does not look like that. */
export function prettyModelId(id: string): string | null {
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?$/);
  if (!m) return null;
  const name = m[1]![0]!.toUpperCase() + m[1]!.slice(1);
  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`;
}

/**
 * What to show for a model: an alias with the version it last ran as ("Sonnet 5.5"),
 * a bare alias name when no version is known yet, a full id made pretty.
 */
export function modelLabel(model: string, resolvedId?: string): string {
  const fromId = prettyModelId(resolvedId ?? model);
  if (fromId) return fromId;
  return /^[a-z]+$/.test(model) ? model[0]!.toUpperCase() + model.slice(1) : model;
}
