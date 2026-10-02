// Native bindings installed by page.rs before evaluating web.js.
declare function nimboDom(operation: string, id: number, arg: string, value: string): string;
interface NimboResponse {
  readonly status: number;
  readonly url: string;
  readonly body: ArrayBuffer | null;
}
declare function nimboRequest(url: string, method: string, body: string): Promise<NimboResponse>;
declare function nimboStorage(area: number, operation: string, key: string, value: string): string;
declare function nimboMedia(query: string): string;
declare const nimboMediaEnvironment: string;
declare const nimboUrl: string;
declare function nimboNow(): number;
declare const nimboTimerLimit: number;
declare const nimboTimerTaskLimit: number;

// QuickJS Context::full installs the native DOMException intrinsic.
declare class DOMException extends Error {
  constructor(message?: string, name?: string);
  readonly code: number;
}

declare function nimboEncode(input: string, capacity: number): string;
declare function nimboDecoder(
  label: string,
  fatal: boolean,
  ignoreBOM: boolean,
): { encoding: string; decode(input: string, stream: boolean): string };

declare function nimboLink(
  operation: string,
  property: string,
  input: string | null,
  base: string,
  value: string,
): string;

// Bounded uncompressed TrueType parsing; other font formats fail explicitly.
declare function nimboFontData(source: Uint8Array): boolean;

declare function nimboFontMeta(field: string, source: string): string;
