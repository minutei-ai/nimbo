import { expect, test } from "bun:test";
import { ownedWorkerdMemory, processMemory, processTreeRss } from "./benchmark-memory";

test("missing processes produce unavailable memory rather than zero", async () => {
  expect(await processMemory(-1)).toBeNull();
  expect(await processTreeRss(-1)).toBeNull();
  expect(await ownedWorkerdMemory(-1)).toBeNull();
});

test.skipIf(process.platform !== "linux")(
  "kernel RSS high water survives releasing a transient allocation",
  async () => {
    const source = `
    globalThis.kept = new Uint8Array(64 * 1024 * 1024);
    kept.fill(1);
    process.stdout.write("allocated\\n");
    await new Response(Bun.stdin).text();
    globalThis.kept = null;
    Bun.gc(true);
    process.stdout.write("released\\n");
    await Bun.sleep(30000);
  `;
    const child = Bun.spawn([process.execPath, "-e", source], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    const reader = child.stdout.getReader();
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("allocated\n");
      const allocated = await processMemory(child.pid);
      expect(allocated).not.toBeNull();
      await child.stdin.end();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("released\n");
      const released = await processMemory(child.pid);
      if (released === null || released.rss_high_water_kib === null || allocated === null)
        throw new Error("Missing owned process memory");
      // The peak must keep the known 64 MiB allocation after it is released. Whether
      // the allocator returns those pages to the kernel varies by host, so current RSS
      // is not asserted. Kernel RSS counters are approximate, not exact allocator bytes.
      expect(allocated.rss_kib).toBeGreaterThan(48 * 1024);
      expect(released.rss_high_water_kib).toBeGreaterThanOrEqual(allocated.rss_kib);
      expect(await ownedWorkerdMemory(child.pid)).toBeNull();
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
      await child.exited;
      reader.releaseLock();
    }
    expect(await processMemory(child.pid)).toBeNull();
  },
  10000,
);
