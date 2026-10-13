import { readFile } from "node:fs/promises";

export async function processTreeRss(pid: number): Promise<number | null> {
  try {
    const [status, children] = await Promise.all([
      readFile(`/proc/${pid}/status`, "utf8"),
      readFile(`/proc/${pid}/task/${pid}/children`, "utf8"),
    ]);
    const own = /VmRSS:\s+(\d+)\s+kB/.exec(status)?.[1];
    if (!own) return null;
    const descendants = await Promise.all(
      children
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((child) => processTreeRss(Number(child))),
    );
    // A partial process tree must not masquerade as lower memory consumption.
    if (descendants.some((value) => value === null)) return null;
    return Number(own) + descendants.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  } catch {
    return null;
  }
}
