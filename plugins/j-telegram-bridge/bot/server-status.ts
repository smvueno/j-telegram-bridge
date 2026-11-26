import { cpus, loadavg, uptime } from "node:os";
import { readdirSync, readFileSync, statfsSync } from "node:fs";

/** The plan-usage part of claude's rate_limit_event line. */
export type PlanUsage = {
  at: number; // when it was seen (ms)
  fiveHour?: { utilization: number; resetsAt: number };
  week?: { utilization: number; resetsAt: number };
};

export function planUsageFrom(event: unknown, now: number): PlanUsage | null {
  const info = (event as { rate_limit_info?: { unifiedWindows?: Record<string, unknown> } })
    ?.rate_limit_info;
  const w = info?.unifiedWindows as
    | Record<string, { utilization?: number; resetsAt?: number } | undefined>
    | undefined;
  if (!w) return null;
  const pick = (x?: { utilization?: number; resetsAt?: number }) =>
    x && typeof x.utilization === "number" && typeof x.resetsAt === "number"
      ? { utilization: x.utilization, resetsAt: x.resetsAt }
      : undefined;
  const out: PlanUsage = { at: now, fiveHour: pick(w.five_hour), week: pick(w.seven_day) };
  return out.fiveHour || out.week ? out : null;
}

import { zoneShort } from "./timezone";

function parts(at: number, zone: string): { day: string; date: string; hm: string } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return { day: get("weekday"), date: `${get("year")}-${get("month")}-${get("day")}`, hm: `${get("hour")}:${get("minute")}` };
}

/** "18:30 JST" today, "Mon 12:00 JST" on another day, in the given time zone. */
export function whenLabel(epochSec: number, now: number, zone = "UTC"): string {
  const at = epochSec * 1000;
  const d = parts(at, zone);
  const n = parts(now, zone);
  const z = zoneShort(zone, at);
  return d.date === n.date ? `${d.hm} ${z}` : `${d.day} ${d.hm} ${z}`;
}

/** "88% ⚠️ (resets Mon 12:00 JST)"; a warning sign from warnAt (0.75). */
export function usageLine(
  w: { utilization: number; resetsAt: number },
  now: number,
  zone = "UTC",
  warnAt = 0.75,
): string {
  const pct = Math.round(w.utilization * 100);
  const warn = w.utilization >= 1 ? " ⛔ limit reached" : w.utilization >= warnAt ? " ⚠️" : "";
  return `${pct}%${warn} (resets ${whenLabel(w.resetsAt, now, zone)})`;
}

export const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

/** "2 d 4 h", "13 h", "25 min" */
export function durationLabel(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h`;
  return `${Math.max(1, Math.floor(sec / 60))} min`;
}

function meminfo(): { total: number; available: number } {
  const txt = readFileSync("/proc/meminfo", "utf8");
  const kb = (k: string) => Number(txt.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] ?? 0) * 1024;
  return { total: kb("MemTotal"), available: kb("MemAvailable") };
}

/** Real memory (RSS) of every process in this service: the bot and its Claudes. */
function serviceRss(): number {
  try {
    const cg = readFileSync("/proc/self/cgroup", "utf8").trim().split(":").pop() ?? "";
    const pids = readFileSync(`/sys/fs/cgroup${cg}/cgroup.procs`, "utf8").trim().split("\n");
    let sum = 0;
    for (const pid of pids) {
      try {
        const m = readFileSync(`/proc/${pid}/status`, "utf8").match(/^VmRSS:\s+(\d+)/m);
        if (m) sum += Number(m[1]) * 1024;
      } catch {
        /* gone */
      }
    }
    return sum;
  } catch {
    return 0;
  }
}

export type ProcSample = { pid: number; label: string; ticks: number; rss: number };
export type UsageRow = { label: string; count: number; cpu: number; rss: number };

/** Sum CPU (from tick deltas over sampleMs) and memory per label; one row per service or program. */
export function groupUsage(
  before: Map<number, number>,
  after: ProcSample[],
  sampleMs: number,
  ticksPerSec = 100,
  cores = 1,
): UsageRow[] {
  const rows = new Map<string, UsageRow>();
  for (const p of after) {
    const prev = before.get(p.pid);
    const delta = prev === undefined ? 0 : Math.max(0, p.ticks - prev);
    // share of the whole server (all cores), so it lines up with the "CPU: x% busy" line
    const cpu = (delta / ticksPerSec / (sampleMs / 1000) / cores) * 100;
    const r = rows.get(p.label) ?? { label: p.label, count: 0, cpu: 0, rss: 0 };
    r.count += 1;
    r.cpu += cpu;
    r.rss += p.rss;
    rows.set(p.label, r);
  }
  return [...rows.values()];
}

/** "web-app (3)  18% CPU, 450 MB" */
export function usageRowLine(r: UsageRow, first: "cpu" | "mem"): string {
  const name = r.count > 1 ? `${r.label} (${r.count})` : r.label;
  const cpu = `${Math.round(r.cpu)}% CPU`;
  const mem = r.rss >= 1024 ** 3 ? `${gb(r.rss)} GB` : `${Math.round(r.rss / 1024 ** 2)} MB`;
  return first === "cpu" ? `${name}: ${cpu}, ${mem}` : `${name}: ${mem}, ${cpu}`;
}

/** Service name from the cgroup (web-app.service -> web-app), else the program name. */
function labelFor(pid: string): string {
  try {
    const cg = readFileSync(`/proc/${pid}/cgroup`, "utf8");
    const m = cg.match(/\/([^/\n]+)\.service\s*$/m);
    if (m) return m[1]!;
  } catch {
    /* gone */
  }
  try {
    return readFileSync(`/proc/${pid}/comm`, "utf8").trim() || "?";
  } catch {
    return "?";
  }
}

function sampleAll(): ProcSample[] {
  const out: ProcSample[] = [];
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      // fields after the ")" that ends the program name: utime is 14th, stime 15th overall
      const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const ticks = Number(f[11]) + Number(f[12]);
      const rss = Number(f[21]) * 4096;
      out.push({ pid: Number(pid), label: labelFor(pid), ticks, rss });
    } catch {
      /* gone */
    }
  }
  return out;
}

/** Top 5 by CPU right now (measured over sampleMs) and top 5 by memory. */
export async function topUsage(sampleMs = 1000, n = 5): Promise<{ cpu: string[]; mem: string[] }> {
  const before = new Map(sampleAll().map((p) => [p.pid, p.ticks]));
  await Bun.sleep(sampleMs);
  const rows = groupUsage(before, sampleAll(), sampleMs, 100, cpus().length);
  const cpu = [...rows].sort((a, b) => b.cpu - a.cpu).slice(0, n).map((r) => usageRowLine(r, "cpu"));
  const mem = [...rows].sort((a, b) => b.rss - a.rss).slice(0, n).map((r) => usageRowLine(r, "mem"));
  return { cpu, mem };
}

export async function serverLines(claudes: string): Promise<{
  server: string[];
  topCpu: string[];
  topMem: string[];
}> {
  const top = topUsage();
  const cores = cpus().length;
  const [l1, l5] = loadavg();
  const mem = meminfo();
  const fs = statfsSync("/");
  const diskTotal = fs.blocks * fs.bsize;
  const diskFree = fs.bavail * fs.bsize;
  const busyPct = Math.round((l1! / cores) * 100);
  const server = [
    `CPU: ${busyPct}% busy (load ${l1!.toFixed(1)}, 5 min ${l5!.toFixed(1)}, ${cores} cores)`,
    `Memory: ${gb(mem.total - mem.available)} of ${gb(mem.total)} GB used (${gb(mem.available)} GB free)`,
    `Disk: ${gb(diskTotal - diskFree)} of ${gb(diskTotal)} GB used (${gb(diskFree)} GB free)`,
    `Up: ${durationLabel(uptime())}`,
    `This bot: ${Math.round(serviceRss() / 1024 ** 2)} MB, ${claudes}`,
  ];
  const t = await top;
  return { server, topCpu: t.cpu, topMem: t.mem };
}
