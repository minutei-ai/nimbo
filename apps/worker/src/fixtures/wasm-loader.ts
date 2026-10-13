import { Schema } from "effect";
import wasm from "nimbo:wasm";
import { initSync, WasmPage, WasmPageLoader } from "../../../../dist/wasm/nimbo_engine.js";
import { Action } from "../protocol";

initSync({ module: wasm });
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Action));
const encoder = new TextEncoder();
const origin = "https://example.test/";

function closedAfterFailure(loader: WasmPageLoader, operation: () => void): boolean {
  try {
    let failed = false;
    try {
      operation();
    } catch {
      failed = true;
    }
    try {
      loader.finish().free();
      return false;
    } catch (cause) {
      return failed && String(cause).includes("document loader is closed");
    }
  } finally {
    loader.free();
  }
}

function extracted(page: WasmPage): boolean {
  try {
    if (decode(page.step()).type !== "ready") return false;
    page.evaluate("document.querySelector('p').textContent");
    const action = decode(page.step());
    return action.type === "result" && action.json === JSON.stringify("kept");
  } finally {
    page.free();
  }
}

export default {
  fetch(): Response {
    const oversized = new WasmPageLoader(origin, false);
    const byteLimited = new WasmPageLoader(origin, false);
    const nodeLimited = new WasmPageLoader(
      origin,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      5,
    );
    const loader = new WasmPageLoader(origin, false);
    loader.feed(encoder.encode("<p>kept</p>"));
    const page = loader.finish();
    loader.free();
    return Response.json({
      oversizedChunkClosed: closedAfterFailure(oversized, () => {
        oversized.feed(new Uint8Array(8193));
      }),
      exhaustedBytesClosed: closedAfterFailure(byteLimited, () => {
        const bytes = encoder.encode("x".repeat(8192));
        for (let index = 0; index <= 256; index++) byteLimited.feed(bytes);
      }),
      nodeQuotaClosed: closedAfterFailure(nodeLimited, () => {
        nodeLimited.feed(encoder.encode("<p><p>"));
      }),
      transferSurvivesLoaderDisposal: extracted(page),
      synchronousConstructor: extracted(new WasmPage("<p>kept</p>", origin, false)),
    });
  },
};
