import { createHash } from "node:crypto";
import { copyFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

// Public, unmodified library inputs. Font binaries remain in ignored build output.
const archiveUrl =
  "https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz";
const archiveSha256 = "7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0";
const names = ["Serif", "Sans", "Mono"].flatMap((family) =>
  ["Regular", "Bold", "Italic", "BoldItalic"].map((style) => `Liberation${family}-${style}.ttf`),
);
const output = process.argv[2];
if (!output) throw new Error("missing Cargo font output directory");
const cache = join(import.meta.dir, "../target/font-reference", archiveSha256);
const archive = join(cache, "reference.tar.gz");
await mkdir(cache, { recursive: true });
if (!(await Bun.file(archive).exists())) {
  const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("public font reference download failed");
  const bytes = await response.arrayBuffer();
  if (createHash("sha256").update(new Uint8Array(bytes)).digest("hex") !== archiveSha256)
    throw new Error("public font archive checksum mismatch");
  const temporary = `${archive}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, bytes);
  await rename(temporary, archive);
}
const bytes = await Bun.file(archive).arrayBuffer();
if (createHash("sha256").update(new Uint8Array(bytes)).digest("hex") !== archiveSha256)
  throw new Error("cached public font archive checksum mismatch");
await mkdir(output, { recursive: true });
const members = [...names, "LICENSE"].map((name) => `liberation-fonts-ttf-2.1.5/${name}`);
const child = Bun.spawn(
  ["tar", "-xzf", archive, "-C", output, "--strip-components=1", ...members],
  { stdout: "ignore", stderr: "ignore" },
);
if ((await child.exited) !== 0) throw new Error("public font reference extraction failed");
// Binary distributions carry the public copyright notice and license alongside fonts.
await copyFile(join(output, "LICENSE"), join(output, "LICENSE.fonts.txt"));
