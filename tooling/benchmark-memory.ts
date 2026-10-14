import { readFile } from "node:fs/promises";

type ProcessSample = {
  name: string;
  rss_kib: number;
  rss_high_water_kib: number | null;
};

function kibibytes(status: string, field: "VmRSS" | "VmHWM"): number | null {
  const raw = new RegExp(`^${field}:\\s+(\\d+)\\s+kB$`, "m").exec(status)?.[1];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export async function processMemory(pid: number) {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const rss = kibibytes(status, "VmRSS");
    if (rss === null) return null;
    return { rss_kib: rss, rss_high_water_kib: kibibytes(status, "VmHWM") };
  } catch {
    return null;
  }
}

async function processTree(pid: number): Promise<ProcessSample[] | null> {
  try {
    const [status, children] = await Promise.all([
      readFile(`/proc/${pid}/status`, "utf8"),
      readFile(`/proc/${pid}/task/${pid}/children`, "utf8"),
    ]);
    const own = kibibytes(status, "VmRSS");
    if (own === null) return null;
    const descendants = await Promise.all(
      children
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((child) => processTree(Number(child))),
    );
    // A partial process tree must not masquerade as lower memory consumption.
    if (descendants.some((value) => value === null)) return null;
    return [
      {
        name: /^Name:[ \t](.*)$/m.exec(status)?.[1] ?? "",
        rss_kib: own,
        rss_high_water_kib: kibibytes(status, "VmHWM"),
      },
      ...descendants.flatMap((value) => value ?? []),
    ];
  } catch {
    return null;
  }
}

export async function processTreeRss(pid: number): Promise<number | null> {
  const tree = await processTree(pid);
  return tree === null ? null : tree.reduce((sum, process) => sum + process.rss_kib, 0);
}

export async function ownedWorkerdMemory(pid: number) {
  const tree = await processTree(pid);
  const workers = tree?.filter((process) => process.name === "workerd");
  const worker = workers?.length === 1 ? workers[0] : undefined;
  return worker === undefined
    ? null
    : { rss_kib: worker.rss_kib, rss_high_water_kib: worker.rss_high_water_kib };
}
