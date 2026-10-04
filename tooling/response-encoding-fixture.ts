import { join } from "node:path";
import { Schema } from "effect";
const Case = Schema.Struct({
  name: Schema.String,
  bytes: Schema.Array(Schema.Finite),
  content_type: Schema.String,
  expected: Schema.String,
});
export const responseEncodingCases = Schema.decodeUnknownSync(Schema.Array(Case))(
  await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/response-encoding.json"),
  ).json(),
);
export function responseEncodingFixture(path: string): Response | undefined {
  const match = /^\/response-encoding\/(\d+)\/(\d+)$/.exec(path);
  if (!match) return undefined;
  const fixture = responseEncodingCases[Number(match[1])];
  if (!fixture) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fixture.bytes), {
    headers: { "content-type": fixture.content_type },
  });
}
