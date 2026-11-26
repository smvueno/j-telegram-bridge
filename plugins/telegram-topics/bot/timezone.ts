/** Time zone helpers for /timezone and the times in /status. */

function valid(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const ALIASES: Record<string, string> = {
  utc: "UTC",
  gmt: "UTC",
  jst: "Asia/Tokyo",
  japan: "Asia/Tokyo",
  denmark: "Europe/Copenhagen",
};

/** "Copenhagen", "new york", "Europe/Copenhagen", "JST" -> an IANA zone; null when unknown. */
export function resolveTimeZone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const alias = ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  if (raw.includes("/") && valid(raw)) {
    // canonical spelling (e.g. europe/copenhagen -> Europe/Copenhagen)
    return new Intl.DateTimeFormat("en-GB", { timeZone: raw }).resolvedOptions().timeZone;
  }
  const want = raw.toLowerCase().replace(/[\s-]+/g, "_");
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.find((z) => z.toLowerCase().split("/").pop() === want) ?? null;
}

/** Short zone name at that moment: "JST", "CET", "GMT+7". */
export function zoneShort(zone: string, at: number): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(new Date(at))
    .find((p) => p.type === "timeZoneName")?.value;
  if (zone === "Asia/Tokyo") return "JST";
  return part ?? zone;
}
