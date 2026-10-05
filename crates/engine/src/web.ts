(() => {
  "use strict";
  const nativeDom = nimboDom;
  const nativeRequest = nimboRequest;
  const nativeStorage = nimboStorage;
  const nativeCookie = nimboCookie;
  const nativeMedia = nimboMedia;
  const nativeEncode = nimboEncode;
  const nativeDecoder = nimboDecoder;
  const nativeLink = nimboLink;
  const nativeCanvas = nimboCanvas;
  const nativeCanvasPut = nimboCanvasPut;
  const nativeFontData = nimboFontData;
  const nativeFontMeta = nimboFontMeta;
  const nativeFontMatch = nimboFontMatch;
  // Values are validated by Rust before installing the page bindings.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const mediaEnvironment = JSON.parse(nimboMediaEnvironment) as { width: number; height: number };
  const href = nimboUrl;
  const now = nimboNow;
  const timerLimit = nimboTimerLimit;
  const timerTaskLimit = nimboTimerTaskLimit;
  Reflect.deleteProperty(globalThis, "nimboDom");
  Reflect.deleteProperty(globalThis, "nimboRequest");
  Reflect.deleteProperty(globalThis, "nimboStorage");
  Reflect.deleteProperty(globalThis, "nimboCookie");
  Reflect.deleteProperty(globalThis, "nimboMedia");
  Reflect.deleteProperty(globalThis, "nimboEncode");
  Reflect.deleteProperty(globalThis, "nimboDecoder");
  Reflect.deleteProperty(globalThis, "nimboLink");
  Reflect.deleteProperty(globalThis, "nimboCanvas");
  Reflect.deleteProperty(globalThis, "nimboCanvasPut");
  Reflect.deleteProperty(globalThis, "nimboFontData");
  Reflect.deleteProperty(globalThis, "nimboFontMeta");
  Reflect.deleteProperty(globalThis, "nimboFontMatch");
  Reflect.deleteProperty(globalThis, "nimboMediaEnvironment");
  Reflect.deleteProperty(globalThis, "nimboUrl");
  Reflect.deleteProperty(globalThis, "nimboNow");
  Reflect.deleteProperty(globalThis, "nimboTimerLimit");
  Reflect.deleteProperty(globalThis, "nimboTimerTaskLimit");

  const ids = new WeakMap<object, number>();
  const nodes = new Map<number, Node>();
  // Result shapes are serialized by Rust for each native operation.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  const raw = <T>(operation: string, id: number, arg = "", value = ""): T => {
    // The bridge owns this JSON contract; it is not page-supplied JSON.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return JSON.parse(nativeDom(operation, id, arg, value)) as T;
  };
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  const call = <T>(operation: string, id: number, arg = "", value = ""): T =>
    customMutation<T>(operation, id, arg, value);

  type Target = EventTarget | typeof globalThis;
  type Listener = ((this: Target, event: Event) => void) | { handleEvent(event: Event): void };
  type EventInit = { bubbles?: unknown; cancelable?: unknown; composed?: unknown };
  type EventState = {
    type: string;
    bubbles: boolean;
    cancelable: boolean;
    composed: boolean;
    target: Target | null;
    current: Target | null;
    phase: number;
    path: Target[];
    dispatching: boolean;
    stopped: boolean;
    immediate: boolean;
    canceled: boolean;
    passive: boolean;
    trusted: boolean;
  };
  type ListenerRecord = {
    callback: Listener;
    capture: boolean;
    once: boolean;
    passive: boolean;
    removed: boolean;
    signal: object | null;
    abort: (() => void) | null;
  };
  const events = new WeakMap<Event, EventState>();
  const listeners = new WeakMap<object, Map<string, ListenerRecord[]>>();
  const targets = new WeakSet<object>();
  const aborts = new WeakMap<
    object,
    { aborted: boolean; reason: unknown; algorithms: Set<() => void> }
  >();
  const controllers = new WeakMap<AbortController, AbortSignal>();
  const details = new WeakMap<CustomEvent, unknown>();
  const errorDetails = new WeakMap<ErrorEvent, { error: unknown; message: string }>();
  function domString(value: unknown): string {
    if (typeof value === "symbol") throw new TypeError("value must be convertible to DOMString");
    return String(value);
  }
  const ByteArray = Uint8Array;
  const typedPrototype: object = Reflect.getPrototypeOf(ByteArray.prototype) ?? ByteArray.prototype;
  // Captured native methods are always called with their validated receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const byteSet = ByteArray.prototype.set;
  const isView = ArrayBuffer.isView.bind(ArrayBuffer);
  function intrinsicGetter(prototype: object, property: PropertyKey): (value: unknown) => unknown {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    // Intrinsic descriptors contain callable accessors.
    // oxlint-disable-next-line typescript/unbound-method
    const getter = descriptor?.get;
    if (!getter) throw new Error("missing buffer intrinsic");
    return (value): unknown => Reflect.apply(getter, value, []);
  }
  const typedTag = intrinsicGetter(typedPrototype, Symbol.toStringTag);
  const typedBuffer = intrinsicGetter(typedPrototype, "buffer");
  const typedOffset = intrinsicGetter(typedPrototype, "byteOffset");
  const typedLength = intrinsicGetter(typedPrototype, "byteLength");
  const dataBuffer = intrinsicGetter(DataView.prototype, "buffer");
  const dataOffset = intrinsicGetter(DataView.prototype, "byteOffset");
  const dataLength = intrinsicGetter(DataView.prototype, "byteLength");
  const bufferLength = intrinsicGetter(ArrayBuffer.prototype, "byteLength");
  const sharedLength =
    typeof SharedArrayBuffer === "undefined"
      ? null
      : intrinsicGetter(SharedArrayBuffer.prototype, "byteLength");
  const encoders = new WeakSet<object>();
  type DecoderBinding = {
    encoding: string;
    fatal: boolean;
    ignoreBOM: boolean;
    decode(input: string, stream: boolean): string;
  };
  const decoders = new WeakMap<object, DecoderBinding>();
  function encodingUnits(value: unknown): string {
    const string = domString(value);
    if (string.length > 65_536) throw new Error("encoding input limit");
    return storageUnits(string);
  }
  function encoded(
    input: unknown,
    capacity: number,
  ): { bytes: number[]; read: number; written: number } {
    // Result shape is produced exclusively by the native UTF-8 encoder.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return JSON.parse(nativeEncode(encodingUnits(input), capacity)) as {
      bytes: number[];
      read: number;
      written: number;
    };
  }
  function encodingOptions(value: unknown): Record<string, unknown> {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" && typeof value !== "function")
      throw new TypeError("invalid options dictionary");
    // Web IDL dictionary members are read from the supplied object.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return value as Record<string, unknown>;
  }
  function bufferBytes(input: unknown): string {
    if (input === undefined) return "[]";
    let buffer: unknown = input;
    let offset: unknown = 0;
    let length: unknown;
    if (isView(input)) {
      const typed = typedTag(input) !== undefined;
      buffer = (typed ? typedBuffer : dataBuffer)(input);
      offset = (typed ? typedOffset : dataOffset)(input);
      length = (typed ? typedLength : dataLength)(input);
    } else {
      try {
        length = bufferLength(input);
      } catch (error) {
        if (!sharedLength) throw error;
        length = sharedLength(input);
      }
    }
    if (typeof length !== "number" || length > 65_536) throw new Error("encoding input limit");
    // Native getters validate BufferSource identity; the constructor rejects detached buffers.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const bytes = new ByteArray(buffer as ArrayBuffer, offset as number, length);
    return JSON.stringify(Array.from(bytes));
  }
  class TextEncoder {
    constructor() {
      encoders.add(this);
    }
    get encoding(): string {
      if (!encoders.has(this)) throw new TypeError("Illegal invocation");
      return "utf-8";
    }
    encode(input: unknown = ""): Uint8Array {
      if (!encoders.has(this)) throw new TypeError("Illegal invocation");
      return new ByteArray(encoded(input, 196_608).bytes);
    }
    encodeInto(source: unknown, destination: unknown): { read: number; written: number } {
      if (!encoders.has(this)) throw new TypeError("Illegal invocation");
      if (arguments.length < 2) throw new TypeError("encodeInto requires source and destination");
      const string = domString(source);
      if (typedTag(destination) !== "Uint8Array")
        throw new TypeError("destination must be Uint8Array");
      // set validates that the genuine typed array has not been detached.
      Reflect.apply(byteSet, destination, [new ByteArray(0)]);
      const capacity = typedLength(destination);
      if (typeof capacity !== "number") throw new TypeError("invalid destination");
      const result = encoded(string, capacity);
      Reflect.apply(byteSet, destination, [new ByteArray(result.bytes)]);
      return { read: result.read, written: result.written };
    }
  }
  class TextDecoder {
    constructor(label: unknown = "utf-8", options?: unknown) {
      const string = domString(label);
      const init = encodingOptions(options);
      const fatal = Boolean(init.fatal);
      const ignoreBOM = Boolean(init.ignoreBOM);
      if (Array.from(string).some((character) => character.charCodeAt(0) > 127))
        throw new RangeError("unknown encoding label");
      decoders.set(this, { ...nativeDecoder(string, fatal, ignoreBOM), fatal, ignoreBOM });
    }
    get encoding(): string {
      return decoderState(this).encoding;
    }
    get fatal(): boolean {
      return decoderState(this).fatal;
    }
    get ignoreBOM(): boolean {
      return decoderState(this).ignoreBOM;
    }
    // The optional first argument gives the Web IDL method a length of zero.
    // oxlint-disable-next-line typescript/no-useless-default-assignment
    decode(input: unknown = undefined, options?: unknown): string {
      const state = decoderState(this);
      const bytes = bufferBytes(input);
      const stream = Boolean(encodingOptions(options).stream);
      return state.decode(bytes, stream);
    }
  }
  function decoderState(value: object): DecoderBinding {
    const state = decoders.get(value);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  Object.defineProperty(TextEncoder.prototype, Symbol.toStringTag, {
    value: "TextEncoder",
    configurable: true,
  });
  Object.defineProperty(TextDecoder.prototype, Symbol.toStringTag, {
    value: "TextDecoder",
    configurable: true,
  });

  const storageAreas = new WeakMap<object, number>();
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  function storageCall<T>(storage: object, operation: string, key = "", value = ""): T {
    const area = storageAreas.get(storage);
    if (area === undefined) throw new TypeError("Illegal invocation");
    // The private bridge returns values produced by Rust, never page-supplied JSON.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return JSON.parse(nativeStorage(area, operation, key, value)) as T;
  }
  function storageUnits(value: unknown): string {
    const string = domString(value);
    const units: number[] = [];
    for (let index = 0; index < string.length; index++) units.push(string.charCodeAt(index));
    return JSON.stringify(units);
  }
  function storageString(units: number[] | null): string | null {
    if (units === null) return null;
    let result = "";
    for (let index = 0; index < units.length; index += 1024)
      result += String.fromCharCode(...units.slice(index, index + 1024));
    return result;
  }
  class Storage {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
    get length(): number {
      return storageCall(this, "length");
    }
    key(index: unknown): string | null {
      if (!storageAreas.has(this)) throw new TypeError("Illegal invocation");
      if (arguments.length === 0) throw new TypeError("key requires an index");
      // Unary plus performs Web IDL's ToNumber and rejects BigInt/Symbol.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-conversion
      const integer = +(index as number) >>> 0;
      return storageString(storageCall(this, "key", JSON.stringify(integer)));
    }
    getItem(key: unknown): string | null {
      if (!storageAreas.has(this)) throw new TypeError("Illegal invocation");
      if (arguments.length === 0) throw new TypeError("getItem requires a key");
      return storageString(storageCall(this, "get", storageUnits(key)));
    }
    setItem(key: unknown, value: unknown): void {
      if (!storageAreas.has(this)) throw new TypeError("Illegal invocation");
      if (arguments.length < 2) throw new TypeError("setItem requires a key and value");
      storageCall(this, "set", storageUnits(key), storageUnits(value));
    }
    removeItem(key: unknown): void {
      if (!storageAreas.has(this)) throw new TypeError("Illegal invocation");
      if (arguments.length === 0) throw new TypeError("removeItem requires a key");
      storageCall(this, "remove", storageUnits(key));
    }
    clear(): void {
      storageCall(this, "clear");
    }
  }
  Object.defineProperty(Storage.prototype, Symbol.toStringTag, {
    value: "Storage",
    configurable: true,
  });
  // Captured methods always run with an explicit branded receiver via call().
  // oxlint-disable-next-line typescript/unbound-method
  const storageGet = Storage.prototype.getItem;
  // oxlint-disable-next-line typescript/unbound-method
  const storageSet = Storage.prototype.setItem;
  // oxlint-disable-next-line typescript/unbound-method
  const storageRemove = Storage.prototype.removeItem;
  function createStorage(area: number): Storage {
    // Construction is reserved for Window; page code cannot manufacture a branded area.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const storageTarget = Object.create(Storage.prototype) as Storage;
    storageAreas.set(storageTarget, area);
    const visible = (key: PropertyKey) =>
      typeof key === "string" &&
      !Reflect.has(storageTarget, key) &&
      storageGet.call(storageTarget, key) !== null;
    const proxy = new Proxy(storageTarget, {
      get(target, key, receiver) {
        if (visible(key)) return storageGet.call(target, key);
        const value: unknown = Reflect.get(target, key, receiver);
        return value;
      },
      has(target, key) {
        return visible(key) || Reflect.has(target, key);
      },
      set(target, key, value: unknown, receiver) {
        if (typeof key === "string" && receiver === proxy) {
          storageSet.call(target, key, value);
          return true;
        }
        return Reflect.set(target, key, value, receiver);
      },
      deleteProperty(target, key) {
        if (visible(key)) {
          storageRemove.call(target, key);
          return true;
        }
        return Reflect.deleteProperty(target, key);
      },
      ownKeys(target) {
        const keys = storageCall<number[][]>(target, "keys").map(
          (units) => storageString(units) ?? "",
        );
        return [...keys.filter(visible), ...Reflect.ownKeys(target)];
      },
      getOwnPropertyDescriptor(target, key) {
        if (visible(key))
          return {
            value: storageGet.call(target, key),
            writable: true,
            enumerable: true,
            configurable: true,
          };
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      defineProperty(target, key, descriptor) {
        if (typeof key === "string") {
          // Proxy invariants prevent the full legacy exotic non-configurable descriptor behavior.
          if (!("value" in descriptor) || descriptor.configurable === false) return false;
          storageSet.call(target, key, descriptor.value);
          return true;
        }
        return Reflect.defineProperty(target, key, descriptor);
      },
      preventExtensions() {
        return false;
      },
    });
    storageAreas.set(proxy, area);
    return proxy;
  }
  const localStorage = createStorage(0);
  const sessionStorage = createStorage(1);
  function eventState(event: Event): EventState {
    const state = events.get(event);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  class Event {
    constructor(type: unknown, init: EventInit | null = {}) {
      if (arguments.length === 0) throw new TypeError("Event requires a type");
      if (init !== null && typeof init !== "object" && typeof init !== "function")
        throw new TypeError("invalid event dictionary");
      const state: EventState = {
        type: domString(type),
        bubbles: Boolean(init?.bubbles),
        cancelable: Boolean(init?.cancelable),
        composed: Boolean(init?.composed),
        target: null,
        current: null,
        phase: 0,
        path: [],
        dispatching: false,
        stopped: false,
        immediate: false,
        canceled: false,
        passive: false,
        trusted: false,
      };
      events.set(this, state);
      Object.defineProperty(this, "isTrusted", { get: () => state.trusted, enumerable: true });
    }
    get type() {
      return eventState(this).type;
    }
    get bubbles() {
      return eventState(this).bubbles;
    }
    get cancelable() {
      return eventState(this).cancelable;
    }
    get composed() {
      return eventState(this).composed;
    }
    get target() {
      return eventState(this).target;
    }
    get currentTarget() {
      return eventState(this).current;
    }
    get eventPhase() {
      return eventState(this).phase;
    }
    get defaultPrevented() {
      return eventState(this).canceled;
    }
    get cancelBubble() {
      return eventState(this).stopped;
    }
    set cancelBubble(value: boolean) {
      if (value) this.stopPropagation();
    }
    get returnValue() {
      return !eventState(this).canceled;
    }
    set returnValue(value: boolean) {
      if (!value) this.preventDefault();
    }
    preventDefault() {
      const state = eventState(this);
      if (state.cancelable && !state.passive) state.canceled = true;
    }
    stopPropagation() {
      eventState(this).stopped = true;
    }
    stopImmediatePropagation() {
      const state = eventState(this);
      state.stopped = true;
      state.immediate = true;
    }
    composedPath(): Target[] {
      return [...eventState(this).path];
    }
  }
  class CustomEvent extends Event {
    constructor(type: unknown, init: (EventInit & { detail?: unknown }) | null = {}) {
      if (arguments.length === 0) throw new TypeError("CustomEvent requires a type");
      super(type, init);
      details.set(this, init?.detail ?? null);
    }
    get detail(): unknown {
      if (!details.has(this)) throw new TypeError("Illegal invocation");
      return details.get(this);
    }
  }
  class ErrorEvent extends Event {
    constructor(
      type: unknown,
      init: (EventInit & { error?: unknown; message?: unknown }) | null = {},
    ) {
      if (arguments.length === 0) throw new TypeError("ErrorEvent requires a type");
      super(type, init);
      errorDetails.set(this, {
        error: init?.error ?? null,
        message: domString(init?.message === undefined ? "" : init.message),
      });
    }
    get error(): unknown {
      const detail = errorDetails.get(this);
      if (!detail) throw new TypeError("Illegal invocation");
      return detail.error;
    }
    get message(): string {
      const detail = errorDetails.get(this);
      if (!detail) throw new TypeError("Illegal invocation");
      return detail.message;
    }
  }
  for (const [name, value] of [
    ["NONE", 0],
    ["CAPTURING_PHASE", 1],
    ["AT_TARGET", 2],
    ["BUBBLING_PHASE", 3],
  ] as const) {
    for (const object of [Event, Event.prototype])
      Object.defineProperty(object, name, { value, enumerable: true });
  }
  function checkTarget(target: Target) {
    if (!targets.has(target)) throw new TypeError("Illegal invocation");
  }
  function removeRecord(records: ListenerRecord[], record: ListenerRecord) {
    record.removed = true;
    const index = records.indexOf(record);
    if (index !== -1) records.splice(index, 1);
    if (record.signal && record.abort) aborts.get(record.signal)?.algorithms.delete(record.abort);
  }
  function eventPath(target: Target, type: string): Target[] {
    const path = [target];
    let id = ids.get(target);
    if (id !== undefined) {
      let parent = call<number | null>("relativeNode", id, "parent");
      while (parent !== null) {
        path.push(node(parent));
        id = parent;
        parent = call<number | null>("relativeNode", parent, "parent");
      }
      if (type !== "load" && call<number>("get", id, "nodeType") === 9) path.push(globalThis);
    }
    return path;
  }
  let reporting = false;
  function reportListenerError(error: unknown) {
    if (reporting) return;
    reporting = true;
    try {
      let message = "uncaught event listener exception";
      try {
        message = error instanceof Error ? error.message : String(error);
      } catch {
        /* Error conversion may itself throw. */
      }
      const event = new ErrorEvent("error", {
        cancelable: true,
        error,
        message,
      });
      dispatch(globalThis, event, true);
    } finally {
      reporting = false;
    }
  }
  function invoke(target: Target, event: Event, capture: boolean, phase: number) {
    const state = eventState(event);
    if (state.stopped) return;
    state.current = target;
    state.phase = phase;
    const records = listeners.get(target)?.get(state.type) ?? [];
    for (const record of records.slice()) {
      if (record.removed || record.capture !== capture) continue;
      if (record.once) removeRecord(records, record);
      state.passive = record.passive;
      try {
        if (typeof record.callback === "function") record.callback.call(target, event);
        else record.callback.handleEvent(event);
      } catch (error) {
        reportListenerError(error);
      } finally {
        state.passive = false;
      }
      if (state.immediate) break;
    }
  }
  function dictionary(options: unknown): object | null {
    return options !== null && (typeof options === "object" || typeof options === "function")
      ? options
      : null;
  }
  function captureOption(options: unknown): boolean {
    const init = dictionary(options);
    return init ? Boolean(Reflect.get(init, "capture")) : Boolean(options);
  }
  function defaultPassive(type: string, target: Target): boolean {
    if (!["touchstart", "touchmove", "wheel", "mousewheel"].includes(type)) return false;
    if (target === globalThis || target === document) return true;
    const id = ids.get(target);
    return (
      id !== undefined &&
      (id === call<number | null>("queryOne", 0, "body") ||
        id === call<number | null>("queryOne", 0, "html"))
    );
  }
  function dispatch(target: Target, event: Event, trusted = false, legacy = false): boolean {
    checkTarget(target);
    const state = eventState(event);
    if (state.dispatching)
      throw new DOMException("event is already being dispatched", "InvalidStateError");
    state.dispatching = true;
    state.trusted = trusted;
    state.target = legacy ? document : target;
    try {
      state.path = eventPath(target, state.type);
      for (let index = state.path.length - 1; index > 0; index--) {
        const current = state.path[index];
        if (current) invoke(current, event, true, 1);
      }
      invoke(target, event, true, 2);
      invoke(target, event, false, 2);
      if (state.bubbles)
        for (const current of state.path.slice(1)) invoke(current, event, false, 3);
      return !state.canceled;
    } finally {
      state.dispatching = false;
      state.current = null;
      state.phase = 0;
      state.path = [];
      state.stopped = false;
      state.immediate = false;
      state.passive = false;
    }
  }
  class EventTarget {
    constructor() {
      targets.add(this);
    }
    addEventListener(
      this: Target,
      type: unknown,
      callback: Listener | null,
      options: unknown = {},
    ) {
      checkTarget(this);
      if (arguments.length < 2) throw new TypeError("addEventListener requires type and callback");
      const name = domString(type);
      const capture = captureOption(options);
      const init = dictionary(options);
      const once = init ? Boolean(Reflect.get(init, "once")) : false;
      const passive: unknown = init ? Reflect.get(init, "passive") : undefined;
      const rawSignal: unknown = init ? Reflect.get(init, "signal") : undefined;
      let signal: object | null = null;
      if (rawSignal !== undefined) {
        const value = dictionary(rawSignal);
        if (!value || !aborts.has(value)) throw new TypeError("invalid AbortSignal");
        signal = value;
      }
      if (callback === null || callback === undefined || (signal && aborts.get(signal)?.aborted))
        return;
      if (typeof callback !== "function" && typeof callback !== "object")
        throw new TypeError("invalid event listener");
      const list = listeners.get(this) ?? new Map<string, ListenerRecord[]>();
      const records = list.get(name) ?? [];
      if (records.some((record) => record.callback === callback && record.capture === capture))
        return;
      const record: ListenerRecord = {
        callback,
        capture,
        once,
        passive: passive === undefined ? defaultPassive(name, this) : Boolean(passive),
        removed: false,
        signal,
        abort: null,
      };
      if (signal) {
        record.abort = () => removeRecord(records, record);
        aborts.get(signal)?.algorithms.add(record.abort);
      }
      records.push(record);
      list.set(name, records);
      listeners.set(this, list);
    }
    removeEventListener(
      this: Target,
      type: unknown,
      callback: Listener | null,
      options: unknown = {},
    ) {
      checkTarget(this);
      if (arguments.length < 2)
        throw new TypeError("removeEventListener requires type and callback");
      const records = listeners.get(this)?.get(domString(type));
      const capture = captureOption(options);
      const record = records?.find(
        (candidate) => candidate.callback === callback && candidate.capture === capture,
      );
      if (records && record) removeRecord(records, record);
    }
    dispatchEvent(this: Target, event: Event): boolean {
      return dispatch(this, event);
    }
  }
  const abortKey = Symbol("abort signal");
  type MediaState = {
    media: string;
    matches: boolean;
    callback: Listener | null;
    handler: Listener | null;
  };
  const mediaLists = new WeakMap<object, MediaState>();
  function mediaState(list: object): MediaState {
    const state = mediaLists.get(list);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  const mediaEvents = new WeakMap<object, { media: string; matches: boolean }>();
  class MediaQueryListEvent extends Event {
    constructor(
      type: unknown,
      init: {
        media?: unknown;
        matches?: unknown;
        bubbles?: unknown;
        cancelable?: unknown;
        composed?: unknown;
      } | null = {},
    ) {
      if (arguments.length === 0) throw new TypeError("MediaQueryListEvent requires a type");
      super(type, init);
      mediaEvents.set(this, {
        media: domString(init?.media === undefined ? "" : init.media),
        matches: Boolean(init?.matches),
      });
    }
    get media(): string {
      const state = mediaEvents.get(this);
      if (!state) throw new TypeError("Illegal invocation");
      return state.media;
    }
    get matches(): boolean {
      const state = mediaEvents.get(this);
      if (!state) throw new TypeError("Illegal invocation");
      return state.matches;
    }
  }
  function isMediaHandler(value: unknown): value is (this: Target, event: Event) => void {
    return typeof value === "function";
  }
  class MediaQueryList extends EventTarget {
    constructor() {
      super();
      throw new TypeError("Illegal constructor");
    }
    get media(): string {
      return mediaState(this).media;
    }
    get matches(): boolean {
      return mediaState(this).matches;
    }
    get onchange(): Listener | null {
      return mediaState(this).callback;
    }
    set onchange(value: unknown) {
      const state = mediaState(this);
      state.callback = isMediaHandler(value) ? value : null;
      if (state.callback && !state.handler) {
        state.handler = (event: Event) => {
          const callback = state.callback;
          if (typeof callback === "function") callback.call(this, event);
        };
        this.addEventListener("change", state.handler);
      } else if (!state.callback && state.handler) {
        this.removeEventListener("change", state.handler);
        state.handler = null;
      }
    }
    addListener(callback: Listener | null): void {
      mediaState(this);
      if (arguments.length === 0) throw new TypeError("addListener requires a callback");
      this.addEventListener("change", callback);
    }
    removeListener(callback: Listener | null): void {
      mediaState(this);
      if (arguments.length === 0) throw new TypeError("removeListener requires a callback");
      this.removeEventListener("change", callback);
    }
  }
  Object.defineProperty(MediaQueryList.prototype, Symbol.toStringTag, {
    value: "MediaQueryList",
    configurable: true,
  });
  function matchMedia(query: unknown): MediaQueryList {
    if (arguments.length === 0) throw new TypeError("matchMedia requires a query");
    // Native CSS tokenization/evaluation returns the parsed media and its result.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const state = JSON.parse(nativeMedia(domString(query))) as MediaState;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const list = Object.create(MediaQueryList.prototype) as MediaQueryList;
    targets.add(list);
    mediaLists.set(list, { ...state, callback: null, handler: null });
    return list;
  }
  class AbortSignal extends EventTarget {
    constructor(key: symbol) {
      super();
      if (key !== abortKey) throw new TypeError("Illegal constructor");
      aborts.set(this, { aborted: false, reason: undefined, algorithms: new Set() });
    }
    get aborted(): boolean {
      const state = aborts.get(this);
      if (!state) throw new TypeError("Illegal invocation");
      return state.aborted;
    }
    get reason(): unknown {
      const state = aborts.get(this);
      if (!state) throw new TypeError("Illegal invocation");
      return state.reason;
    }
    throwIfAborted() {
      const state = aborts.get(this);
      if (!state) throw new TypeError("Illegal invocation");
      if (state.aborted) throw state.reason;
    }
    static abort(reason?: unknown): AbortSignal {
      const controller = new AbortController();
      controller.abort(reason);
      return controller.signal;
    }
  }
  class AbortController {
    constructor() {
      controllers.set(this, new AbortSignal(abortKey));
    }
    get signal(): AbortSignal {
      const signal = controllers.get(this);
      if (!signal) throw new TypeError("Illegal invocation");
      return signal;
    }
    abort(reason: unknown = new DOMException("operation aborted", "AbortError")) {
      const signal = controllers.get(this);
      const state = signal ? aborts.get(signal) : undefined;
      if (!state || !signal) throw new TypeError("Illegal invocation");
      if (state.aborted) return;
      state.aborted = true;
      state.reason = reason;
      for (const algorithm of Array.from(state.algorithms)) algorithm();
      state.algorithms.clear();
      dispatch(signal, new Event("abort"), true);
    }
  }
  for (const [prototype, tag] of [
    [Event.prototype, "Event"],
    [CustomEvent.prototype, "CustomEvent"],
    [ErrorEvent.prototype, "ErrorEvent"],
    [EventTarget.prototype, "EventTarget"],
    [AbortSignal.prototype, "AbortSignal"],
    [AbortController.prototype, "AbortController"],
  ] as const)
    Object.defineProperty(prototype, Symbol.toStringTag, { value: tag, configurable: true });
  function idOf(candidate: object): number {
    const id = ids.get(candidate);
    if (id === undefined) throw new TypeError("invalid Node");
    return id;
  }
  const internal = Symbol("native node");
  type Collection = NodeList | HTMLCollection;
  type CollectionItems = readonly (Node | number)[];
  type CollectionState = { resolve: () => CollectionItems };
  function collectionNode(value: Node | number | undefined): Node | undefined {
    return typeof value === "number" ? node(value) : value;
  }
  const collections = new WeakMap<Collection, CollectionState>();
  const childLists = new WeakMap<Node, NodeList>();
  const elementLists = new WeakMap<ParentNode, HTMLCollection>();
  function collectionState(list: Collection): CollectionState {
    const state = collections.get(list);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  function namedNodes(items: CollectionItems): Map<string, Element> {
    const names = new Map<string, Element>();
    for (const value of items) {
      const item = collectionNode(value);
      if (!(item instanceof Element)) continue;
      const id = item.getAttribute("id");
      const name =
        item.namespaceURI === "http://www.w3.org/1999/xhtml" ? item.getAttribute("name") : null;
      for (const key of [id, name]) {
        if (key && !names.has(key)) names.set(key, item);
      }
    }
    return names;
  }
  function propertyIndex(key: string | symbol): number | null {
    if (typeof key !== "string") return null;
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < 4294967295 && String(index) === key
      ? index
      : null;
  }
  function makeCollection<T extends Collection>(
    target: T,
    resolve: () => CollectionItems,
    named = false,
  ): T {
    const state = { resolve };
    const visibleName = (key: string | symbol): Element | undefined =>
      named && typeof key === "string" && !Reflect.has(target, key)
        ? namedNodes(resolve()).get(key)
        : undefined;
    const proxy = new Proxy(target, {
      get(object, key, receiver): unknown {
        const index = propertyIndex(key);
        if (index !== null) return collectionNode(resolve()[index]);
        return visibleName(key) ?? Reflect.get(object, key, receiver);
      },
      has(object, key) {
        const index = propertyIndex(key);
        return index !== null
          ? index < resolve().length
          : Reflect.has(object, key) || visibleName(key) !== undefined;
      },
      ownKeys(object) {
        const items = resolve();
        const keys: (string | symbol)[] = Array.from({ length: items.length }, (_, index) =>
          String(index),
        );
        if (named) {
          for (const key of namedNodes(items).keys()) if (!Reflect.has(object, key)) keys.push(key);
        }
        return Array.from(new Set([...keys, ...Reflect.ownKeys(object)]));
      },
      getOwnPropertyDescriptor(object, key) {
        const index = propertyIndex(key);
        if (index !== null) {
          const value = collectionNode(resolve()[index]);
          return value === undefined
            ? undefined
            : { value, writable: false, enumerable: true, configurable: true };
        }
        const value = visibleName(key);
        return value === undefined
          ? Reflect.getOwnPropertyDescriptor(object, key)
          : { value, writable: false, enumerable: false, configurable: true };
      },
      defineProperty(object, key, descriptor) {
        if (propertyIndex(key) !== null) return false;
        if (
          named &&
          typeof key === "string" &&
          !Object.hasOwn(object, key) &&
          namedNodes(resolve()).has(key)
        )
          return false;
        return Reflect.defineProperty(object, key, descriptor);
      },
      deleteProperty(object, key) {
        const index = propertyIndex(key);
        if (index !== null) return index >= resolve().length;
        return visibleName(key) === undefined && Reflect.deleteProperty(object, key);
      },
      preventExtensions() {
        return false;
      },
    });
    collections.set(target, state);
    collections.set(proxy, state);
    return proxy;
  }
  class NodeList {
    constructor(key: symbol) {
      if (key !== internal) throw new TypeError("Illegal constructor");
    }
    get length(): number {
      return collectionState(this).resolve().length;
    }
    item(index: number): Node | null {
      if (arguments.length === 0) throw new TypeError("item requires an index");
      return collectionNode(collectionState(this).resolve()[index >>> 0]) ?? null;
    }
    forEach(
      callback: (this: unknown, value: Node, index: number, list: NodeList) => void,
      thisArg?: unknown,
    ) {
      const state = collectionState(this);
      if (typeof callback !== "function") throw new TypeError("callback must be a function");
      const length = state.resolve().length;
      for (let index = 0; index < length; index++) {
        const value = collectionNode(state.resolve()[index]);
        if (value !== undefined) callback.call(thisArg, value, index, this);
      }
    }
    entries(): Generator<[number, Node]> {
      return collectionEntries(collectionState(this));
    }
    keys(): Generator<number> {
      const state = collectionState(this);
      return (function* () {
        for (let index = 0; index < state.resolve().length; index++) yield index;
      })();
    }
    values(): Generator<Node> {
      return collectionValues(collectionState(this));
    }
    [Symbol.iterator](): Generator<Node> {
      return this.values();
    }
  }
  function* collectionEntries(state: CollectionState): Generator<[number, Node]> {
    for (let index = 0; ; index++) {
      const value = collectionNode(state.resolve()[index]);
      if (value === undefined) return;
      yield [index, value];
    }
  }
  function* collectionValues(state: CollectionState): Generator<Node> {
    for (const [, value] of collectionEntries(state)) yield value;
  }
  class HTMLCollection {
    constructor(key: symbol) {
      if (key !== internal) throw new TypeError("Illegal constructor");
    }
    get length(): number {
      return collectionState(this).resolve().length;
    }
    item(index: number): Element | null {
      if (arguments.length === 0) throw new TypeError("item requires an index");
      const value = collectionNode(collectionState(this).resolve()[index >>> 0]);
      return value instanceof Element ? value : null;
    }
    namedItem(name: unknown): Element | null {
      if (arguments.length === 0) throw new TypeError("namedItem requires a name");
      if (typeof name === "symbol") throw new TypeError("name must be convertible to a DOMString");
      return namedNodes(collectionState(this).resolve()).get(String(name)) ?? null;
    }
    [Symbol.iterator](): Generator<Node> {
      return collectionValues(collectionState(this));
    }
  }
  Object.defineProperty(NodeList.prototype, Symbol.iterator, {
    // Web IDL requires the same unbound prototype method for both names.
    // oxlint-disable-next-line typescript/unbound-method
    value: NodeList.prototype.values,
    writable: true,
    configurable: true,
  });
  for (const [prototype, tag] of [
    [NodeList.prototype, "NodeList"],
    [HTMLCollection.prototype, "HTMLCollection"],
  ] as const) {
    Object.defineProperty(prototype, Symbol.toStringTag, { value: tag, configurable: true });
  }
  class Node extends EventTarget {
    constructor(key: symbol, id: number) {
      super();
      if (key !== internal) throw new TypeError("Illegal constructor");
      ids.set(this, id);
      nodes.set(id, this);
    }
    private relativeNode(relation: string): Node | null {
      const id = call<number | null>("relativeNode", idOf(this), relation);
      return id === null ? null : node(id);
    }
    get childNodes(): NodeList {
      let list = childLists.get(this);
      if (!list) {
        list = makeCollection(new NodeList(internal), () =>
          call<number[]>("children", idOf(this), "nodes").map(node),
        );
        childLists.set(this, list);
      }
      return list;
    }
    get parentNode(): Node | null {
      return this.relativeNode("parent");
    }
    get firstChild(): Node | null {
      return this.relativeNode("first");
    }
    get lastChild(): Node | null {
      return this.relativeNode("last");
    }
    get nextSibling(): Node | null {
      return this.relativeNode("next");
    }
    get previousSibling(): Node | null {
      return this.relativeNode("previous");
    }
    get nodeType(): number {
      return call("get", idOf(this), "nodeType");
    }
    get nodeName(): string {
      return call("get", idOf(this), "nodeName");
    }
    get baseURI(): string {
      idOf(this);
      return documentBase();
    }
    get ownerDocument(): Document | null {
      return this.nodeType === 9 ? null : document;
    }
    get nodeValue(): string | null {
      return call("get", idOf(this), "nodeValue");
    }
    set nodeValue(value: string | number | null) {
      call("set", idOf(this), "nodeValue", String(value ?? ""));
    }
    get parentElement(): Element | null {
      const id = call<number | null>("parentElement", idOf(this));
      return id === null ? null : element(id);
    }
    get isConnected(): boolean {
      return call("get", idOf(this), "isConnected");
    }
    contains(other: Node | null): boolean {
      return other !== null && call("contains", idOf(this), String(idOf(other)));
    }
    get textContent(): string | null {
      return call("get", idOf(this), "textContent");
    }
    set textContent(value: string | number | null) {
      call("set", idOf(this), "textContent", String(value ?? ""));
    }
    appendChild<T extends Node>(child: T): T {
      call("append", idOf(this), "", String(idOf(child)));
      return child;
    }
    insertBefore<T extends Node>(child: T, reference: Node | null): T {
      call(
        "insert",
        idOf(this),
        reference === null ? "" : String(idOf(reference)),
        String(idOf(child)),
      );
      return child;
    }
    replaceChild<T extends Node>(child: Node, replaced: T): T {
      call("replace", idOf(this), String(idOf(replaced)), String(idOf(child)));
      return replaced;
    }
    removeChild<T extends Node>(child: T): T {
      call("removeChild", idOf(this), "", String(idOf(child)));
      return child;
    }
    remove() {
      call("remove", idOf(this));
    }
  }
  function nodeArguments(values: unknown[]): (Node | string)[] {
    return values.map((value) => {
      if (value instanceof Node) {
        idOf(value);
        return value;
      }
      return domString(value);
    });
  }
  function convertedNode(values: (Node | string)[]): Node {
    const converted = values.map((value) => (typeof value === "string" ? new Text(value) : value));
    const single = converted[0];
    if (converted.length === 1 && single) return single;
    const fragment = new DocumentFragment();
    for (const child of converted) insertNode(fragment, child, null);
    return fragment;
  }
  function relative(target: Node, relation: string): Node | null {
    const result = call<number | null>("relativeNode", idOf(target), relation);
    return result === null ? null : node(result);
  }
  function insertNode(parent: Node, child: Node, reference: Node | null): void {
    customMutation<void>(
      "insert",
      idOf(parent),
      reference === null ? "" : String(idOf(reference)),
      String(idOf(child)),
      true,
    );
  }
  function childOperation(
    target: Node,
    operation: "before" | "after" | "replaceWith",
    values: unknown[],
  ): void {
    idOf(target);
    const args = nodeArguments(values);
    reactions(() => {
      const parent = relative(target, "parent");
      if (!parent) return;
      let viable = relative(target, operation === "before" ? "previous" : "next");
      while (viable && args.includes(viable))
        viable = relative(viable, operation === "before" ? "previous" : "next");
      const child = convertedNode(args);
      if (operation === "before")
        insertNode(parent, child, viable ? relative(viable, "next") : relative(parent, "first"));
      else if (operation === "replaceWith" && relative(target, "parent") === parent)
        customMutation<void>(
          "replace",
          idOf(parent),
          String(idOf(target)),
          String(idOf(child)),
          true,
        );
      else insertNode(parent, child, viable);
    });
  }
  function parentOperation(target: Node, prepend: boolean, values: unknown[]): void {
    idOf(target);
    const args = nodeArguments(values);
    reactions(() => {
      const child = convertedNode(args);
      insertNode(target, child, prepend ? relative(target, "first") : null);
    });
  }
  class ParentNode extends Node {
    get children(): HTMLCollection {
      let list = elementLists.get(this);
      if (!list) {
        list = makeCollection(
          new HTMLCollection(internal),
          () => call<number[]>("children", idOf(this), "elements").map(element),
          true,
        );
        elementLists.set(this, list);
      }
      return list;
    }
    get childElementCount(): number {
      return this.children.length;
    }
    querySelectorAll(selector: string): NodeList {
      const snapshot = call<number[]>("query", idOf(this), selector);
      return makeCollection(new NodeList(internal), () => snapshot);
    }
    querySelector(selector: string): Element | null {
      const id = call<number | null>("queryOne", idOf(this), selector);
      return id === null ? null : element(id);
    }
  }
  function tagElements(owner: Element | Document, qualifiedName: unknown): HTMLCollection {
    const id = idOf(owner);
    const name = domString(qualifiedName);
    const lower = name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    return makeCollection(
      new HTMLCollection(internal),
      () =>
        call<number[]>("query", id, "*").filter((candidate) => {
          if (name === "*") return true;
          const namespace = call<string | null>("get", candidate, "namespaceURI");
          const local = call<string>("get", candidate, "localName");
          const prefix = call<string | null>("get", candidate, "prefix");
          const qualified = prefix === null ? local : `${prefix}:${local}`;
          return qualified === (namespace === "http://www.w3.org/1999/xhtml" ? lower : name);
        }),
      true,
    );
  }
  const tokenElements = new WeakMap<object, { id: number; attribute: string }>();
  const classLists = new WeakMap<Element, Map<string, DOMTokenList>>();
  function tokenAttribute(list: object): string {
    const state = tokenElements.get(list);
    if (!state) throw new TypeError("Illegal invocation");
    return state.attribute;
  }
  function tokenElement(list: object): number {
    const id = tokenElements.get(list)?.id;
    if (id === undefined) throw new TypeError("Illegal invocation");
    return id;
  }
  function tokenValue(list: object): string | null {
    return call("attr", tokenElement(list), tokenAttribute(list));
  }
  function tokenValues(list: object): string[] {
    return Array.from(new Set((tokenValue(list) ?? "").split(/[\t\n\f\r ]+/).filter(Boolean)));
  }
  function validateToken(token: string): void {
    if (token === "") throw new DOMException("empty token", "SyntaxError");
    if (/[\t\n\f\r ]/.test(token))
      throw new DOMException("token contains ASCII whitespace", "InvalidCharacterError");
  }
  function updateTokens(list: object, values: string[]): void {
    const id = tokenElement(list);
    if (values.length === 0 && tokenValue(list) === null) return;
    call("setAttr", id, tokenAttribute(list), values.join(" "));
  }
  class DOMTokenList {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
    get length(): number {
      return tokenValues(this).length;
    }
    get value(): string {
      return tokenValue(this) ?? "";
    }
    set value(value: unknown) {
      call("setAttr", tokenElement(this), tokenAttribute(this), domString(value));
    }
    item(index: unknown): string | null {
      tokenElement(this);
      if (arguments.length === 0) throw new TypeError("item requires an index");
      // Web IDL ToNumber must reject BigInt and Symbol.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-conversion
      const integer = +(index as number) >>> 0;
      return tokenValues(this)[integer] ?? null;
    }
    contains(token: unknown): boolean {
      tokenElement(this);
      if (arguments.length === 0) throw new TypeError("contains requires a token");
      const value = domString(token);
      return tokenValues(this).includes(value);
    }
    add(...tokens: unknown[]): void {
      tokenElement(this);
      const values = tokens.map(domString);
      values.forEach(validateToken);
      updateTokens(this, Array.from(new Set([...tokenValues(this), ...values])));
    }
    remove(...tokens: unknown[]): void {
      tokenElement(this);
      const values = tokens.map(domString);
      values.forEach(validateToken);
      updateTokens(
        this,
        tokenValues(this).filter((token) => !values.includes(token)),
      );
    }
    toggle(token: unknown, force?: unknown): boolean {
      tokenElement(this);
      if (arguments.length === 0) throw new TypeError("toggle requires a token");
      const value = domString(token);
      validateToken(value);
      const values = tokenValues(this),
        present = values.includes(value);
      if (present) {
        if (force === undefined || !force) {
          updateTokens(
            this,
            values.filter((candidate) => candidate !== value),
          );
          return false;
        }
        return true;
      }
      if (force === undefined || force) {
        updateTokens(this, [...values, value]);
        return true;
      }
      return false;
    }
    replace(token: unknown, replacement: unknown): boolean {
      tokenElement(this);
      if (arguments.length < 2) throw new TypeError("replace requires two tokens");
      const old = domString(token),
        next = domString(replacement);
      if (old === "" || next === "") throw new DOMException("empty token", "SyntaxError");
      validateToken(old);
      validateToken(next);
      const values = tokenValues(this);
      if (!values.includes(old)) return false;
      updateTokens(
        this,
        Array.from(new Set(values.map((value) => (value === old ? next : value)))),
      );
      return true;
    }
    supports(token: unknown): boolean {
      tokenElement(this);
      if (arguments.length === 0) throw new TypeError("supports requires a token");
      domString(token);
      if (tokenAttribute(this) === "class")
        throw new TypeError("class has no supported-token vocabulary");
      // Link navigation/auxiliary contexts are not implemented, so no rel
      // processing-model token is advertised as supported.
      return false;
    }
    toString(): string {
      return tokenValue(this) ?? "";
    }
    forEach(
      callback: (this: unknown, value: string, index: number, list: DOMTokenList) => void,
      thisArg?: unknown,
    ): void {
      tokenElement(this);
      if (typeof callback !== "function") throw new TypeError("callback must be callable");
      let index = 0;
      for (const value of this) callback.call(thisArg, value, index++, this);
    }
    entries(): Generator<[number, string]> {
      tokenElement(this);
      return tokenEntries(this);
    }
    values(): Generator<string> {
      tokenElement(this);
      return tokenIterator(this);
    }
    keys(): Generator<number> {
      tokenElement(this);
      return tokenKeys(this);
    }
    [Symbol.iterator](): Generator<string> {
      return this.values();
    }
  }
  function* tokenEntries(list: DOMTokenList): Generator<[number, string]> {
    for (let index = 0; index < tokenValues(list).length; index++) {
      const value = tokenValues(list)[index];
      if (value !== undefined) yield [index, value];
    }
  }
  function* tokenKeys(list: DOMTokenList): Generator<number> {
    for (const [index] of tokenEntries(list)) yield index;
  }
  function* tokenIterator(list: DOMTokenList): Generator<string> {
    for (const [, value] of tokenEntries(list)) yield value;
  }
  Object.defineProperty(DOMTokenList.prototype, Symbol.toStringTag, {
    value: "DOMTokenList",
    configurable: true,
  });
  function classList(owner: Element, attribute = "class"): DOMTokenList {
    const cached = classLists.get(owner)?.get(attribute);
    if (cached) return cached;
    const id = idOf(owner);
    if (call<number>("get", id, "nodeType") !== 1) throw new TypeError("Illegal invocation");
    // Only the Element getter manufactures a branded list.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const target = Object.create(DOMTokenList.prototype) as DOMTokenList;
    tokenElements.set(target, { id, attribute });
    const proxy = new Proxy(target, {
      get(object, key, receiver): unknown {
        const index = propertyIndex(key);
        return index === null ? Reflect.get(object, key, receiver) : tokenValues(object)[index];
      },
      has(object, key) {
        const index = propertyIndex(key);
        return index === null ? Reflect.has(object, key) : index < tokenValues(object).length;
      },
      ownKeys(object) {
        return [
          ...tokenValues(object).map((_, index) => String(index)),
          ...Reflect.ownKeys(object),
        ];
      },
      getOwnPropertyDescriptor(object, key) {
        const index = propertyIndex(key);
        if (index === null) return Reflect.getOwnPropertyDescriptor(object, key);
        const value = tokenValues(object)[index];
        return value === undefined
          ? undefined
          : { value, writable: false, enumerable: true, configurable: true };
      },
      defineProperty(object, key, descriptor) {
        return propertyIndex(key) === null && Reflect.defineProperty(object, key, descriptor);
      },
      deleteProperty(object, key) {
        const index = propertyIndex(key);
        return index === null
          ? Reflect.deleteProperty(object, key)
          : index >= tokenValues(object).length;
      },
      preventExtensions() {
        return false;
      },
    });
    tokenElements.set(proxy, { id, attribute });
    let lists = classLists.get(owner);
    if (!lists) {
      lists = new Map();
      classLists.set(owner, lists);
    }
    lists.set(attribute, proxy);
    return proxy;
  }
  type RectValues = { x: number; y: number; width: number; height: number };
  const rectValues = new WeakMap<DOMRectReadOnly, RectValues>();
  function rectNumber(value: unknown): number {
    // Web IDL's unrestricted double conversion uses ToNumber, including its
    // rejection of BigInt and Symbol even when returned by an object coercion.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-conversion
    return +(value as number);
  }
  function rectState(value: DOMRectReadOnly): RectValues {
    const state = rectValues.get(value);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  class DOMRectReadOnly {
    constructor(x: unknown = 0, y: unknown = 0, width: unknown = 0, height: unknown = 0) {
      rectValues.set(this, {
        x: rectNumber(x),
        y: rectNumber(y),
        width: rectNumber(width),
        height: rectNumber(height),
      });
    }
    static fromRect(value: Partial<RectValues> | null = {}): DOMRectReadOnly {
      if (value !== null && typeof value !== "object" && typeof value !== "function")
        throw new TypeError("Expected dictionary");
      return new DOMRectReadOnly(value?.x, value?.y, value?.width, value?.height);
    }
    get x(): number {
      return rectState(this).x;
    }
    get y(): number {
      return rectState(this).y;
    }
    get width(): number {
      return rectState(this).width;
    }
    get height(): number {
      return rectState(this).height;
    }
    get top(): number {
      const s = rectState(this);
      return Math.min(s.y, s.y + s.height);
    }
    get right(): number {
      const s = rectState(this);
      return Math.max(s.x, s.x + s.width);
    }
    get bottom(): number {
      const s = rectState(this);
      return Math.max(s.y, s.y + s.height);
    }
    get left(): number {
      const s = rectState(this);
      return Math.min(s.x, s.x + s.width);
    }
    toJSON(): RectValues & { top: number; right: number; bottom: number; left: number } {
      const s = rectState(this);
      return {
        ...s,
        top: Math.min(s.y, s.y + s.height),
        right: Math.max(s.x, s.x + s.width),
        bottom: Math.max(s.y, s.y + s.height),
        left: Math.min(s.x, s.x + s.width),
      };
    }
    get [Symbol.toStringTag](): string {
      return "DOMRectReadOnly";
    }
  }
  class DOMRect extends DOMRectReadOnly {
    static override fromRect(value: Partial<RectValues> | null = {}): DOMRect {
      const rect = DOMRectReadOnly.fromRect(value);
      return new DOMRect(rect.x, rect.y, rect.width, rect.height);
    }
    override get x(): number {
      return super.x;
    }
    override set x(value: unknown) {
      rectState(this).x = rectNumber(value);
    }
    override get y(): number {
      return super.y;
    }
    override set y(value: unknown) {
      rectState(this).y = rectNumber(value);
    }
    override get width(): number {
      return super.width;
    }
    override set width(value: unknown) {
      rectState(this).width = rectNumber(value);
    }
    override get height(): number {
      return super.height;
    }
    override set height(value: unknown) {
      rectState(this).height = rectNumber(value);
    }
    override get [Symbol.toStringTag](): string {
      return "DOMRect";
    }
  }
  for (const [prototype, tag] of [
    [DOMRectReadOnly.prototype, "DOMRectReadOnly"],
    [DOMRect.prototype, "DOMRect"],
  ] as const) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (descriptor) Object.defineProperty(prototype, name, { ...descriptor, enumerable: true });
    }
    Object.defineProperty(prototype, Symbol.toStringTag, { value: tag, configurable: true });
  }
  class Element extends ParentNode {
    getElementsByTagName(qualifiedName: unknown): HTMLCollection {
      if (!(this instanceof Element)) throw new TypeError("Illegal invocation");
      required(1, arguments.length);
      return tagElements(this, qualifiedName);
    }

    append(...values: unknown[]): void {
      if (!(this instanceof Element)) throw new TypeError("Illegal invocation");
      parentOperation(this, false, values);
    }
    prepend(...values: unknown[]): void {
      if (!(this instanceof Element)) throw new TypeError("Illegal invocation");
      parentOperation(this, true, values);
    }

    before(...values: unknown[]): void {
      if (!(this instanceof Element)) throw new TypeError("Illegal invocation");
      childOperation(this, "before", values);
    }
    after(...values: unknown[]): void {
      if (!(this instanceof Element)) throw new TypeError("Illegal invocation");
      childOperation(this, "after", values);
    }
    replaceWith(...values: unknown[]): void {
      if (!(this instanceof Element)) throw new TypeError("Illegal invocation");
      childOperation(this, "replaceWith", values);
    }

    getBoundingClientRect(): DOMRect {
      const result = call<RectValues>("bounds", idOf(this));
      return new DOMRect(result.x, result.y, result.width, result.height);
    }
    get clientTop(): number {
      return elementGeometry(this, "clientTop");
    }
    get clientLeft(): number {
      return elementGeometry(this, "clientLeft");
    }
    get clientWidth(): number {
      return elementGeometry(this, "clientWidth");
    }
    get clientHeight(): number {
      return elementGeometry(this, "clientHeight");
    }
    get scrollWidth(): number {
      return elementGeometry(this, "scrollWidth");
    }
    get scrollHeight(): number {
      return elementGeometry(this, "scrollHeight");
    }
    get scrollTop(): number {
      return elementGeometry(this, "scrollTop");
    }
    set scrollTop(value: unknown) {
      setElementScroll(this, "scrollTop", value);
    }
    get scrollLeft(): number {
      return elementGeometry(this, "scrollLeft");
    }
    set scrollLeft(value: unknown) {
      setElementScroll(this, "scrollLeft", value);
    }
    get classList(): DOMTokenList {
      return classList(this);
    }
    set classList(value: unknown) {
      classList(this).value = value;
    }

    matches(selector: string): boolean {
      return call("matches", idOf(this), selector);
    }
    closest(selector: string): Element | null {
      const id = call<number | null>("closest", idOf(this), selector);
      return id === null ? null : element(id);
    }
    private relativeElement(relation: string): Element | null {
      const id = call<number | null>("relativeElement", idOf(this), relation);
      return id === null ? null : element(id);
    }
    get firstElementChild(): Element | null {
      return this.relativeElement("first");
    }
    get lastElementChild(): Element | null {
      return this.relativeElement("last");
    }
    get nextElementSibling(): Element | null {
      return this.relativeElement("next");
    }
    get previousElementSibling(): Element | null {
      return this.relativeElement("previous");
    }
    get innerHTML(): string {
      return call("get", idOf(this), "innerHTML");
    }
    set innerHTML(value: string | number | null) {
      call("set", idOf(this), "innerHTML", String(value));
    }
    get outerHTML(): string {
      return call("get", idOf(this), "outerHTML");
    }
    get namespaceURI(): string | null {
      return call("get", idOf(this), "namespaceURI");
    }
    get prefix(): string | null {
      return call("get", idOf(this), "prefix");
    }
    get localName(): string {
      return call("get", idOf(this), "localName");
    }
    get tagName(): string {
      return call("get", idOf(this), "tagName");
    }
    get id(): string {
      return this.getAttribute("id") ?? "";
    }
    set id(value: string | number | null) {
      this.setAttribute("id", value);
    }
    get className(): string {
      return this.getAttribute("class") ?? "";
    }
    set className(value: string | number | null) {
      this.setAttribute("class", value);
    }
    getAttribute(name: string): string | null {
      return call("attr", idOf(this), name);
    }
    setAttribute(name: string, value: string | number | null) {
      call("setAttr", idOf(this), name, String(value));
    }
    hasAttribute(name: string): boolean {
      return this.getAttribute(name) !== null;
    }
    removeAttribute(name: string) {
      call("removeAttr", idOf(this), name);
    }
  }
  function elementGeometry(owner: object, name: string): number {
    if (!(owner instanceof Element)) throw new TypeError("Illegal invocation");
    return call("geometry", idOf(owner), name);
  }
  function setElementScroll(owner: object, name: string, value: unknown): void {
    if (!(owner instanceof Element)) throw new TypeError("Illegal invocation");
    const number = rectNumber(value);
    call("geometry", idOf(owner), name, String(Number.isFinite(number) ? number : 0));
  }
  const htmlElements = new WeakSet<object>();
  function isHTML(candidate: Node): candidate is HTMLElement {
    return htmlElements.has(candidate);
  }
  function htmlId(owner: object): number {
    if (!htmlElements.has(owner)) throw new TypeError("Illegal invocation");
    return idOf(owner);
  }
  function htmlAttribute(owner: object, name: string): string | null {
    return call("attr", htmlId(owner), name);
  }
  function reflectString(owner: object, name: string, value: unknown): void {
    call("setAttr", htmlId(owner), name, domString(value));
  }
  function reflectBoolean(owner: object, name: string, value: unknown): void {
    const id = htmlId(owner);
    call(value ? "setAttr" : "removeAttr", id, name);
  }
  type StyleOutput = {
    entries: { name: string; value: string; important: boolean }[];
    css_text: string;
    value: string;
    important: boolean;
    changed: boolean;
  };
  const styleOwners = new WeakMap<object, number>();
  const computedStyles = new WeakSet<object>();
  const inlineStyles = new WeakMap<object, CSSStyleProperties>();
  const ruleStyleOwners = new WeakMap<object, CSSStyleRule>();
  function styleOperation(
    owner: object,
    operation = "get",
    name = "",
    value = "",
    priority = "",
  ): StyleOutput {
    const id = styleOwners.get(owner);
    if (id === undefined) throw new TypeError("Illegal invocation");
    if (ruleStyleOwners.has(owner))
      return cssomCall<StyleOutput>(
        "style",
        id,
        operation,
        JSON.stringify({ name, value, priority }),
      );
    if (computedStyles.has(owner)) {
      if (operation !== "get" && operation !== "name")
        throw new DOMException("computed styles are read-only", "NoModificationAllowedError");
      return call<StyleOutput>("computedStyle", id, operation, name);
    }
    return call<StyleOutput>("style", id, operation, JSON.stringify({ name, value, priority }));
  }
  class CSSStyleDeclaration {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
    get cssText(): string {
      return styleOperation(this).css_text;
    }
    set cssText(value: unknown) {
      styleOperation(this, "text", "", domString(value));
    }
    get length(): number {
      return styleOperation(this).entries.length;
    }
    get parentRule(): CSSStyleRule | null {
      styleOperation(this);
      return ruleStyleOwners.get(this) ?? null;
    }
    item(index: unknown): string {
      styleOperation(this);
      if (arguments.length < 1) throw new TypeError("index is required");
      if (typeof index === "bigint") throw new TypeError("index must be a number");
      // Unary plus applies Web IDL ToNumber, including object coercion.
      // TypeScript cannot express Web IDL numeric coercion of arbitrary values.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-conversion
      const converted = +(index as number);
      const integer = Number.isFinite(converted) ? Math.trunc(converted) : 0;
      const unsigned = ((integer % 4294967296) + 4294967296) % 4294967296;
      return styleOperation(this).entries[unsigned]?.name ?? "";
    }
    getPropertyValue(property: unknown): string {
      styleOperation(this);
      if (arguments.length < 1) throw new TypeError("property is required");
      return styleOperation(this, "get", domString(property)).value;
    }
    getPropertyPriority(property: unknown): string {
      styleOperation(this);
      if (arguments.length < 1) throw new TypeError("property is required");
      if (computedStyles.has(this)) {
        domString(property);
        return "";
      }
      return styleOperation(this, "get", domString(property)).important ? "important" : "";
    }
    setProperty(property: unknown, value: unknown, priority?: unknown): void {
      styleOperation(this);
      if (arguments.length < 2) throw new TypeError("property and value are required");
      styleOperation(
        this,
        "set",
        domString(property),
        value === null ? "" : domString(value),
        priority === null || priority === undefined ? "" : domString(priority),
      );
    }
    removeProperty(property: unknown): string {
      styleOperation(this);
      if (arguments.length < 1) throw new TypeError("property is required");
      return styleOperation(this, "remove", domString(property)).value;
    }
  }
  class CSSStyleProperties extends CSSStyleDeclaration {
    get cssFloat(): string {
      return styleOperation(this, "get", "float").value;
    }
    set cssFloat(value: unknown) {
      styleOperation(this, "set", "float", value === null ? "" : domString(value));
    }
  }
  Object.defineProperty(CSSStyleDeclaration.prototype, Symbol.toStringTag, {
    value: "CSSStyleDeclaration",
    configurable: true,
  });
  Object.defineProperty(CSSStyleProperties.prototype, Symbol.toStringTag, {
    value: "CSSStyleProperties",
    configurable: true,
  });
  function styleName(key: PropertyKey): string | null {
    if (typeof key !== "string" || key.startsWith("--")) return null;
    if (key === "cssFloat") return "float";
    if (key === "webkitTextSizeAdjust") return "text-size-adjust";
    return key.includes("-") ? key : key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
  }
  function inlineStyle(owner: object, computed = false, rule?: CSSStyleRule): CSSStyleProperties {
    if (!rule && !computed && !htmlElements.has(owner) && !svgElements.has(owner))
      throw new TypeError("Illegal invocation");
    const id = rule ? cssRuleId(rule) : idOf(owner);
    const cached = computed ? undefined : inlineStyles.get(owner);
    if (cached) return cached;
    const prototype =
      computed || rule ? CSSStyleDeclaration.prototype : CSSStyleProperties.prototype;
    // Declarations are manufactured only by branded element APIs.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const target = Object.create(prototype) as CSSStyleProperties;
    styleOwners.set(target, id);
    if (rule) ruleStyleOwners.set(target, rule);
    if (computed) computedStyles.add(target);
    const proxy = new Proxy(target, {
      get(object, key, receiver): unknown {
        const index = propertyIndex(key);
        if (index !== null) return styleOperation(object).entries[index]?.name;
        if (Reflect.has(object, key)) return Reflect.get(object, key, receiver);
        const name = styleName(key);
        return name !== null && styleOperation(object, "name", name).value
          ? styleOperation(object, "get", name).value
          : undefined;
      },
      set(object, key, value, receiver) {
        if (propertyIndex(key) !== null) return false;
        const name = styleName(key);
        if (
          !Reflect.has(object, key) &&
          name !== null &&
          styleOperation(object, "name", name).value
        ) {
          styleOperation(object, "set", name, value === null ? "" : domString(value));
          return true;
        }
        return Reflect.set(object, key, value, receiver);
      },
      has(object, key) {
        const index = propertyIndex(key);
        if (index !== null) return index < styleOperation(object).entries.length;
        const name = styleName(key);
        return (
          Reflect.has(object, key) ||
          (name !== null && !!styleOperation(object, "name", name).value)
        );
      },
      ownKeys(object) {
        return [
          ...styleOperation(object).entries.map((_, index) => String(index)),
          ...Reflect.ownKeys(object),
        ];
      },
      getOwnPropertyDescriptor(object, key) {
        const index = propertyIndex(key);
        if (index === null) return Reflect.getOwnPropertyDescriptor(object, key);
        const value = styleOperation(object).entries[index]?.name;
        return value === undefined
          ? undefined
          : { value, writable: false, enumerable: true, configurable: true };
      },
      defineProperty(object, key, descriptor) {
        const name = styleName(key);
        if (computed && name !== null && styleOperation(object, "name", name).value)
          throw new DOMException("computed styles are read-only", "NoModificationAllowedError");
        return propertyIndex(key) === null && Reflect.defineProperty(object, key, descriptor);
      },
      deleteProperty(object, key) {
        const index = propertyIndex(key);
        return index === null
          ? Reflect.deleteProperty(object, key)
          : index >= styleOperation(object).entries.length;
      },
      preventExtensions() {
        return false;
      },
    });
    styleOwners.set(proxy, id);
    if (rule) ruleStyleOwners.set(proxy, rule);
    if (computed) computedStyles.add(proxy);
    else inlineStyles.set(owner, proxy);
    return proxy;
  }
  function getComputedStyle(ownerElement: object, pseudo?: unknown): CSSStyleDeclaration {
    if (arguments.length < 1) throw new TypeError("element is required");
    const id = idOf(ownerElement);
    if (call<number>("get", id, "nodeType") !== 1) throw new TypeError("element is required");
    const name = pseudo === null || pseudo === undefined ? "" : domString(pseudo);
    if (name !== "")
      throw new DOMException("computed pseudo-elements are not implemented", "NotSupportedError");
    return inlineStyle(ownerElement, true);
  }
  // Rules and declaration state live in Rust; these maps preserve wrapper identity only.
  const cssSheetIds = new WeakMap<object, number>();
  const cssSheets = new Map<number, CSSStyleSheet>();
  const cssRuleIds = new WeakMap<object, number>();
  const cssRules = new Map<number, CSSStyleRule>();
  const cssListSheets = new WeakMap<object, CSSStyleSheet>();
  const cssSheetLists = new WeakMap<object, CSSRuleList>();
  type NativeSheet = {
    rules: number[];
    disabled: boolean;
    owner: number | null;
    href: string | null;
  };
  type NativeRule = { selector: string; cssText: string; parent: number | null };
  // Native operation output shapes are fixed by the Rust CSSOM arena.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  function cssomCall<T>(operation: string, id: number, arg = "", value = ""): T {
    const result = call<T>("cssom", id, operation, JSON.stringify({ arg, value }));
    if (
      typeof result === "object" &&
      result !== null &&
      "exception" in result &&
      typeof result.exception === "string"
    )
      throw new DOMException("CSSOM operation failed", result.exception);
    return result;
  }
  function cssSheetId(owner: object): number {
    const id = cssSheetIds.get(owner);
    if (id === undefined) throw new TypeError("Illegal invocation");
    return id;
  }
  function cssRuleId(owner: object): number {
    const id = cssRuleIds.get(owner);
    if (id === undefined) throw new TypeError("Illegal invocation");
    return id;
  }
  function cssSheetState(owner: object): NativeSheet {
    return cssomCall<NativeSheet>("sheet", cssSheetId(owner));
  }
  function cssRuleState(owner: object): NativeRule {
    return cssomCall<NativeRule>("rule", cssRuleId(owner));
  }
  function cssIndex(value: unknown): number {
    if (typeof value === "bigint") throw new TypeError("index must be a number");
    // Web IDL ToNumber requires coercion, including user-defined conversion.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-conversion
    const number = +(value as number);
    const integer = Number.isFinite(number) ? Math.trunc(number) : 0;
    return ((integer % 4294967296) + 4294967296) % 4294967296;
  }
  class StyleSheet {
    constructor(key?: symbol) {
      if (key !== internal) throw new TypeError("Illegal constructor");
    }
    get type(): string {
      cssSheetId(this);
      return "text/css";
    }
    get href(): string | null {
      return cssSheetState(this).href;
    }
    get ownerNode(): Node | null {
      const owner = cssSheetState(this).owner;
      return owner === null ? null : node(owner);
    }
    get parentStyleSheet(): null {
      cssSheetId(this);
      return null;
    }
    get title(): null {
      cssSheetId(this);
      return null;
    }
    get disabled(): boolean {
      return cssSheetState(this).disabled;
    }
    set disabled(value: unknown) {
      cssomCall("disabled", cssSheetId(this), "", String(Boolean(value)));
    }
  }
  class CSSStyleSheet extends StyleSheet {
    constructor(options?: unknown) {
      super(internal);
      if (options !== undefined && options !== null)
        throw new DOMException("CSSStyleSheet options are not implemented", "NotSupportedError");
      const id = cssomCall<number>("new", 0);
      cssSheetIds.set(this, id);
      cssSheets.set(id, this);
    }
    replace(text: unknown): Promise<CSSStyleSheet> {
      try {
        const id = cssSheetId(this);
        required(1, arguments.length);
        const source = domString(text);
        cssomCall("replaceStart", id, "", source);
        return Promise.resolve().then(() => {
          cssomCall("replaceFinish", id, "", source);
          return this;
        });
      } catch (error) {
        return Promise.reject(error);
      }
    }
    replaceSync(text: unknown): void {
      required(1, arguments.length);
      cssomCall("replace", cssSheetId(this), "", domString(text));
    }
    get ownerRule(): null {
      cssSheetId(this);
      return null;
    }
    get cssRules(): CSSRuleList {
      cssomCall("sheetAccess", cssSheetId(this));
      let list = cssSheetLists.get(this);
      if (!list) {
        list = new CSSRuleList(internal, this);
        cssSheetLists.set(this, list);
      }
      return list;
    }
    insertRule(rule: unknown, index?: unknown): number {
      const id = cssSheetId(this);
      if (arguments.length < 1) throw new TypeError("rule is required");
      const source = domString(rule);
      const position = cssIndex(index);
      return cssomCall<number>("insert", id, String(position), source);
    }
    deleteRule(index: unknown): void {
      const id = cssSheetId(this);
      if (arguments.length < 1) throw new TypeError("index is required");
      cssomCall("delete", id, String(cssIndex(index)));
    }
  }
  class CSSRule {
    static readonly STYLE_RULE = 1;
    constructor() {
      throw new TypeError("Illegal constructor");
    }
    get type(): number {
      cssRuleId(this);
      return 1;
    }
    get cssText(): string {
      return cssRuleState(this).cssText;
    }
    set cssText(value: unknown) {
      cssRuleId(this);
      domString(value);
    }
    get parentRule(): null {
      cssRuleId(this);
      return null;
    }
    get parentStyleSheet(): CSSStyleSheet | null {
      const parent = cssRuleState(this).parent;
      return parent === null ? null : (cssSheets.get(parent) ?? null);
    }
  }
  class CSSStyleRule extends CSSRule {
    get selectorText(): string {
      return cssRuleState(this).selector;
    }
    set selectorText(value: unknown) {
      cssomCall("selector", cssRuleId(this), "", domString(value));
    }
    get style(): CSSStyleDeclaration {
      cssRuleId(this);
      return inlineStyle(this, false, this);
    }
    set style(value: unknown) {
      cssRuleId(this);
      inlineStyle(this, false, this).cssText = value;
    }
  }
  Object.defineProperty(CSSRule.prototype, "STYLE_RULE", { value: 1, enumerable: true });
  function cssSheetWrapper(id: number): CSSStyleSheet {
    const cached = cssSheets.get(id);
    if (cached) return cached;
    // Native state owns the sheet; this map preserves JavaScript identity.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const sheet = Object.create(CSSStyleSheet.prototype) as CSSStyleSheet;
    cssSheetIds.set(sheet, id);
    cssSheets.set(id, sheet);
    return sheet;
  }
  function cssRuleWrapper(id: number): CSSStyleRule {
    const cached = cssRules.get(id);
    if (cached) return cached;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const owner = Object.create(CSSStyleRule.prototype) as CSSStyleRule;
    cssRuleIds.set(owner, id);
    cssRules.set(id, owner);
    return owner;
  }
  function cssListState(owner: object): number[] {
    const sheet = cssListSheets.get(owner);
    if (!sheet) throw new TypeError("Illegal invocation");
    return cssomCall<number[]>("sheetRules", cssSheetId(sheet));
  }
  function cssIndexedList<T extends object>(
    target: T,
    state: (owner: object) => number[],
    wrap: (id: number) => object,
  ): T {
    return new Proxy(target, {
      get: (owner, key, receiver) => {
        const index = propertyIndex(key);
        const id = index === null ? undefined : state(owner)[index];
        return index === null
          ? Reflect.get(owner, key, receiver)
          : id === undefined
            ? undefined
            : wrap(id);
      },
      set: (owner, key, value, receiver) =>
        propertyIndex(key) !== null || Reflect.set(owner, key, value, receiver),
      has: (owner, key) => {
        const index = propertyIndex(key);
        return index === null ? Reflect.has(owner, key) : index < state(owner).length;
      },
      ownKeys: (owner) => [
        ...state(owner).map((_, index) => String(index)),
        ...Reflect.ownKeys(owner),
      ],
      getOwnPropertyDescriptor: (owner, key) => {
        const index = propertyIndex(key);
        if (index === null) return Reflect.getOwnPropertyDescriptor(owner, key);
        const id = state(owner)[index];
        return id === undefined
          ? undefined
          : { value: wrap(id), writable: false, enumerable: true, configurable: true };
      },
      defineProperty: (owner, key, descriptor) =>
        propertyIndex(key) !== null
          ? descriptor.configurable !== false
          : Reflect.defineProperty(owner, key, descriptor),
      deleteProperty: (owner, key) => {
        const index = propertyIndex(key);
        return index === null ? Reflect.deleteProperty(owner, key) : index >= state(owner).length;
      },
      preventExtensions: () => false,
    });
  }
  class CSSRuleList {
    constructor(token: symbol, sheet: CSSStyleSheet) {
      if (token !== internal) throw new TypeError("Illegal constructor");
      cssListSheets.set(this, sheet);
      const proxy = cssIndexedList(this, cssListState, cssRuleWrapper);
      cssListSheets.set(proxy, sheet);
      return proxy;
    }
    get length(): number {
      return cssListState(this).length;
    }
    item(index: unknown): CSSStyleRule | null {
      cssListState(this);
      if (arguments.length < 1) throw new TypeError("index is required");
      const id = cssListState(this)[cssIndex(index)];
      return id === undefined ? null : cssRuleWrapper(id);
    }
    *[Symbol.iterator](): Generator<CSSStyleRule> {
      for (let i = 0; ; i++) {
        const id = cssListState(this)[i];
        if (id === undefined) return;
        yield cssRuleWrapper(id);
      }
    }
  }
  const sheetListDocuments = new WeakMap<object, Document>();
  const documentSheetLists = new WeakMap<object, StyleSheetList>();
  function documentSheetIds(owner: object): number[] {
    const doc = sheetListDocuments.get(owner);
    if (!doc) throw new TypeError("Illegal invocation");
    return call<number[]>("styleSheets", idOf(doc));
  }
  class StyleSheetList {
    constructor(token: symbol, doc: Document) {
      if (token !== internal) throw new TypeError("Illegal constructor");
      sheetListDocuments.set(this, doc);
      const proxy = cssIndexedList(this, documentSheetIds, cssSheetWrapper);
      sheetListDocuments.set(proxy, doc);
      return proxy;
    }
    get length(): number {
      return documentSheetIds(this).length;
    }
    item(index: unknown): CSSStyleSheet | null {
      documentSheetIds(this);
      required(1, arguments.length);
      const id = documentSheetIds(this)[cssIndex(index)];
      return id === undefined ? null : cssSheetWrapper(id);
    }
    *[Symbol.iterator](): Generator<CSSStyleSheet> {
      for (let index = 0; ; index++) {
        const id = documentSheetIds(this)[index];
        if (id === undefined) return;
        yield cssSheetWrapper(id);
      }
    }
  }
  for (const [prototype, tag] of [
    [StyleSheet.prototype, "StyleSheet"],
    [CSSStyleSheet.prototype, "CSSStyleSheet"],
    [CSSRule.prototype, "CSSRule"],
    [CSSStyleRule.prototype, "CSSStyleRule"],
    [CSSRuleList.prototype, "CSSRuleList"],
    [StyleSheetList.prototype, "StyleSheetList"],
  ] as const)
    Object.defineProperty(prototype, Symbol.toStringTag, { value: tag, configurable: true });
  const datasets = new WeakMap<object, DOMStringMap>();
  const svgElements = new WeakSet<object>();
  // The nonconstructible Web IDL interface still exposes a constructor/prototype pair.
  // oxlint-disable-next-line typescript/no-extraneous-class
  class DOMStringMap {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
  }
  Object.defineProperty(DOMStringMap.prototype, Symbol.toStringTag, {
    value: "DOMStringMap",
    configurable: true,
  });
  function dataAttribute(name: string, validate = false): string {
    if (validate && /-[a-z]/.test(name))
      throw new DOMException("invalid dataset name", "SyntaxError");
    const attribute = "data-" + name.replace(/[A-Z]/g, (char) => "-" + char.toLowerCase());
    if (validate && (attribute.includes("\0") || /[\t\n\f\r />=]/.test(attribute)))
      throw new DOMException("invalid attribute name", "InvalidCharacterError");
    return attribute;
  }
  function dataset(owner: object): DOMStringMap {
    if (!htmlElements.has(owner) && !svgElements.has(owner))
      throw new TypeError("Illegal invocation");
    const cached = datasets.get(owner);
    if (cached) return cached;
    const id = idOf(owner);
    const entries = (): [string, string][] =>
      raw<[string, string, string | null][]>("attributes", id)
        .filter(([name]) => name.startsWith("data-") && !/[A-Z]/.test(name.slice(5)))
        .map(([name, value]) => [
          name.slice(5).replace(/-([a-z])/g, (_whole: string, char: string) => char.toUpperCase()),
          value,
        ]);
    const read = (key: PropertyKey): string | undefined =>
      typeof key === "string" ? entries().find(([name]) => name === key)?.[1] : undefined;
    const write = (key: string, value: unknown): boolean => {
      const converted = domString(value);
      const attribute = dataAttribute(key, true);
      call("setAttr", id, attribute, converted);
      return true;
    };
    // Only branded native element getters construct the legacy attribute view.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const target = Object.create(DOMStringMap.prototype) as DOMStringMap;
    const proxy: DOMStringMap = new Proxy(target, {
      get(object, key, receiver): unknown {
        return read(key) ?? Reflect.get(object, key, receiver);
      },
      has(object, key) {
        return read(key) !== undefined || Reflect.has(object, key);
      },
      set(object, key, value, receiver) {
        return typeof key === "string" && receiver === proxy
          ? write(key, value)
          : Reflect.set(object, key, value, receiver);
      },
      ownKeys(object) {
        return [...entries().map(([name]) => name), ...Reflect.ownKeys(object)];
      },
      getOwnPropertyDescriptor(object, key) {
        const value = read(key);
        return value === undefined
          ? Reflect.getOwnPropertyDescriptor(object, key)
          : { value, writable: true, enumerable: true, configurable: true };
      },
      defineProperty(object, key, descriptor) {
        if (typeof key !== "string") return Reflect.defineProperty(object, key, descriptor);
        if ("get" in descriptor || "set" in descriptor || descriptor.configurable === false)
          return false;
        return write(key, descriptor.value);
      },
      deleteProperty(object, key) {
        if (typeof key === "string" && read(key) !== undefined) {
          call("removeAttr", id, dataAttribute(key));
          return true;
        }
        return Reflect.deleteProperty(object, key);
      },
      preventExtensions() {
        return false;
      },
    });
    datasets.set(owner, proxy);
    return proxy;
  }
  class SVGElement extends Element {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      svgElements.add(this);
    }
    get style(): CSSStyleProperties {
      if (!svgElements.has(this)) throw new TypeError("Illegal invocation");
      return inlineStyle(this);
    }
    set style(value: unknown) {
      if (!svgElements.has(this)) throw new TypeError("Illegal invocation");
      styleOperation(inlineStyle(this), "text", "", domString(value));
    }
    get dataset(): DOMStringMap {
      if (!svgElements.has(this)) throw new TypeError("Illegal invocation");
      return dataset(this);
    }
  }
  Object.defineProperty(SVGElement.prototype, Symbol.toStringTag, {
    value: "SVGElement",
    configurable: true,
  });
  class HTMLElement extends Element {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) return constructHTML(new.target);
      super(internal, id);
      htmlElements.add(this);
      return this;
    }
    get offsetParent(): Element | null {
      const id = call<number | null>("geometry", htmlId(this), "offsetParent");
      return id === null ? null : element(id);
    }
    get offsetTop(): number {
      return call("geometry", htmlId(this), "offsetTop");
    }
    get offsetLeft(): number {
      return call("geometry", htmlId(this), "offsetLeft");
    }
    get offsetWidth(): number {
      return call("geometry", htmlId(this), "offsetWidth");
    }
    get offsetHeight(): number {
      return call("geometry", htmlId(this), "offsetHeight");
    }
    get dataset(): DOMStringMap {
      htmlId(this);
      return dataset(this);
    }
    get style(): CSSStyleProperties {
      htmlId(this);
      return inlineStyle(this);
    }
    set style(value: unknown) {
      htmlId(this);
      styleOperation(inlineStyle(this), "text", "", domString(value));
    }
    get title(): string {
      return htmlAttribute(this, "title") ?? "";
    }
    set title(value: unknown) {
      reflectString(this, "title", value);
    }
    get lang(): string {
      return htmlAttribute(this, "lang") ?? "";
    }
    set lang(value: unknown) {
      reflectString(this, "lang", value);
    }
    get accessKey(): string {
      return htmlAttribute(this, "accesskey") ?? "";
    }
    set accessKey(value: unknown) {
      reflectString(this, "accesskey", value);
    }
    get dir(): string {
      const value = (htmlAttribute(this, "dir") ?? "").replace(/[A-Z]/g, (char) =>
        char.toLowerCase(),
      );
      return ["ltr", "rtl", "auto"].includes(value) ? value : "";
    }
    set dir(value: unknown) {
      reflectString(this, "dir", value);
    }
    get inert(): boolean {
      return htmlAttribute(this, "inert") !== null;
    }
    set inert(value: unknown) {
      reflectBoolean(this, "inert", value);
    }
    get hidden(): boolean | string {
      const value = htmlAttribute(this, "hidden");
      return value === null
        ? false
        : value.replace(/[A-Z]/g, (char) => char.toLowerCase()) === "until-found"
          ? "until-found"
          : true;
    }
    set hidden(value: unknown) {
      htmlId(this);
      const converted =
        value === null || value === undefined
          ? null
          : typeof value === "boolean" || typeof value === "number" || typeof value === "string"
            ? value
            : domString(value);
      if (
        typeof converted === "string" &&
        converted.replace(/[A-Z]/g, (char) => char.toLowerCase()) === "until-found"
      )
        reflectString(this, "hidden", "until-found");
      else reflectBoolean(this, "hidden", converted);
    }
  }
  Object.defineProperty(HTMLElement.prototype, Symbol.toStringTag, {
    value: "HTMLElement",
    configurable: true,
  });
  for (const prototype of [HTMLElement.prototype, SVGElement.prototype]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "dataset");
    if (descriptor)
      Object.defineProperty(prototype, "dataset", { ...descriptor, enumerable: true });
  }
  function usvString(value: unknown): string {
    return domString(value).replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      "\ufffd",
    );
  }
  function linkValue(
    operation: string,
    property: string,
    input: string | null,
    base: string,
    value = "",
  ): string | null {
    const result: unknown = JSON.parse(nativeLink(operation, property, input, base, value));
    if (result === null || typeof result === "string") return result;
    throw new Error("invalid native URL result");
  }
  type QueryPair = [string, string];
  type QueryState = { pairs: QueryPair[]; owner?: URL };
  const queryStates = new WeakMap<object, QueryState>();
  const urlStates = new WeakMap<object, { href: string; params: URLSearchParams }>();
  function queryState(owner: object): QueryState {
    const state = queryStates.get(owner);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  function urlState(owner: object) {
    const state = urlStates.get(owner);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  function queryParse(input: string): QueryPair[] {
    const result: unknown = JSON.parse(nativeLink("queryParse", "", input, "", ""));
    if (!Array.isArray(result)) throw new Error("invalid native query result");
    return result.map((entry: unknown): QueryPair => {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        typeof entry[1] !== "string"
      )
        throw new Error("invalid native query pair");
      return [entry[0], entry[1]];
    });
  }
  function querySerialize(pairs: QueryPair[]): string {
    return linkValue("querySerialize", "", JSON.stringify(pairs), "") ?? "";
  }
  function updateQuery(state: QueryState, pairs: QueryPair[]): void {
    const serialized = querySerialize(pairs);
    const owner = state.owner;
    if (owner) {
      const url = urlState(owner);
      url.href = linkValue("set", "search", url.href, "", serialized) ?? url.href;
    }
    state.pairs = pairs;
  }
  function required(count: number, actual: number): void {
    if (actual < count) throw new TypeError("Missing required argument");
  }
  function sequence(value: unknown, method?: unknown): Iterable<unknown> {
    if ((typeof value !== "object" || value === null) && typeof value !== "function")
      throw new TypeError("Sequence must be an object");
    const iteratorMethod: unknown = method ?? Reflect.get(value, Symbol.iterator);
    if (typeof iteratorMethod !== "function") throw new TypeError("Sequence is not iterable");
    const iterator: unknown = Reflect.apply(iteratorMethod, value, []);
    if ((typeof iterator !== "object" || iterator === null) && typeof iterator !== "function")
      throw new TypeError("Invalid iterator");
    const next: unknown = Reflect.get(iterator, "next");
    if (typeof next !== "function") throw new TypeError("Invalid iterator next method");
    return {
      [Symbol.iterator]: () => ({
        // The native for-of protocol validates the returned iterator result.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        next: () => Reflect.apply(next, iterator, []) as IteratorResult<unknown>,
      }),
    };
  }
  function queryInit(init: unknown): QueryPair[] {
    const pairs: QueryPair[] = [];
    let inputSize = 0;
    function addPair(name: string, value: string): void {
      inputSize += name.length + value.length + 2;
      if (inputSize > 65_536) throw new Error("URL query input limit exceeded");
      pairs.push([name, value]);
    }
    if ((typeof init === "object" && init !== null) || typeof init === "function") {
      const method: unknown = Reflect.get(init, Symbol.iterator);
      if (method !== null && method !== undefined) {
        const convertedPairs: string[][] = [];
        let sequenceSize = 0;
        for (const entry of sequence(init, method)) {
          const pair: string[] = [];
          sequenceSize += 2;
          for (const value of sequence(entry)) {
            const converted = usvString(value);
            sequenceSize += converted.length + 1;
            if (sequenceSize > 65_536) throw new Error("URL query input limit exceeded");
            pair.push(converted);
          }
          if (sequenceSize > 65_536) throw new Error("URL query input limit exceeded");
          convertedPairs.push(pair);
        }
        for (const pair of convertedPairs) {
          if (pair.length !== 2) throw new TypeError("Query pair requires exactly two items");
          addPair(pair[0] ?? "", pair[1] ?? "");
        }
      } else {
        const record = new Map<string, string>();
        for (const key of Reflect.ownKeys(init))
          if (Object.getOwnPropertyDescriptor(init, key)?.enumerable)
            record.set(usvString(key), usvString(Reflect.get(init, key)));
        for (const [name, value] of record) addPair(name, value);
      }
    } else {
      return queryParse(usvString(init).replace(/^\?/, ""));
    }
    querySerialize(pairs);
    return pairs;
  }
  const queryIterators = new WeakMap<
    object,
    { state: QueryState; kind: "keys" | "values" | "entries"; index: number }
  >();
  class QueryIterator {
    constructor(state: QueryState, kind: "keys" | "values" | "entries") {
      queryIterators.set(this, { state, kind, index: 0 });
    }
    next(): IteratorResult<string | QueryPair> {
      const iterator = queryIterators.get(this);
      if (!iterator) throw new TypeError("Illegal invocation");
      const pair = iterator.state.pairs[iterator.index];
      if (!pair) {
        return { value: undefined, done: true };
      }
      iterator.index++;
      return {
        value:
          iterator.kind === "entries" ? [pair[0], pair[1]] : pair[iterator.kind === "keys" ? 0 : 1],
        done: false,
      };
    }
  }
  const arrayIteratorPrototype: unknown = Object.getPrototypeOf([][Symbol.iterator]());
  if (typeof arrayIteratorPrototype !== "object" || arrayIteratorPrototype === null)
    throw new Error("Missing native iterator prototype");
  const iteratorPrototype: unknown = Object.getPrototypeOf(arrayIteratorPrototype);
  if (typeof iteratorPrototype !== "object" || iteratorPrototype === null)
    throw new Error("Missing native iterator prototype");
  Object.setPrototypeOf(QueryIterator.prototype, iteratorPrototype);
  const queryNext = Object.getOwnPropertyDescriptor(QueryIterator.prototype, "next");
  if (queryNext)
    Object.defineProperty(QueryIterator.prototype, "next", { ...queryNext, enumerable: true });
  Object.defineProperty(QueryIterator.prototype, Symbol.toStringTag, {
    value: "URLSearchParams Iterator",
    configurable: true,
  });
  class URLSearchParams {
    constructor(init: unknown = "") {
      queryStates.set(this, { pairs: queryInit(init) });
    }
    get size(): number {
      return queryState(this).pairs.length;
    }
    append(name: unknown, value: unknown): void {
      const state = queryState(this);
      required(2, arguments.length);
      updateQuery(state, [...state.pairs, [usvString(name), usvString(value)]]);
    }
    // Web IDL excludes optional arguments from the exposed function length.
    // oxlint-disable-next-line typescript/no-useless-default-assignment
    delete(name: unknown, value: unknown = undefined): void {
      const state = queryState(this);
      required(1, arguments.length);
      const key = usvString(name),
        match = value === undefined ? undefined : usvString(value);
      updateQuery(
        state,
        state.pairs.filter(
          ([entryName, entryValue]) =>
            entryName !== key || (match !== undefined && entryValue !== match),
        ),
      );
    }
    get(name: unknown): string | null {
      const state = queryState(this);
      required(1, arguments.length);
      const key = usvString(name);
      return state.pairs.find(([entryName]) => entryName === key)?.[1] ?? null;
    }
    getAll(name: unknown): string[] {
      const state = queryState(this);
      required(1, arguments.length);
      const key = usvString(name);
      return state.pairs.filter(([entryName]) => entryName === key).map(([, value]) => value);
    }
    // Web IDL excludes optional arguments from the exposed function length.
    // oxlint-disable-next-line typescript/no-useless-default-assignment
    has(name: unknown, value: unknown = undefined): boolean {
      const state = queryState(this);
      required(1, arguments.length);
      const key = usvString(name),
        match = value === undefined ? undefined : usvString(value);
      return state.pairs.some(
        ([entryName, entryValue]) =>
          entryName === key && (match === undefined || entryValue === match),
      );
    }
    set(name: unknown, value: unknown): void {
      const state = queryState(this);
      required(2, arguments.length);
      const key = usvString(name),
        converted = usvString(value);
      let found = false;
      const pairs: QueryPair[] = [];
      for (const pair of state.pairs) {
        if (pair[0] !== key) pairs.push(pair);
        else if (!found) {
          pairs.push([key, converted]);
          found = true;
        }
      }
      if (!found) pairs.push([key, converted]);
      updateQuery(state, pairs);
    }
    sort(): void {
      const state = queryState(this);
      updateQuery(
        state,
        state.pairs.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    toString(): string {
      return querySerialize(queryState(this).pairs);
    }
    keys() {
      return new QueryIterator(queryState(this), "keys");
    }
    values() {
      return new QueryIterator(queryState(this), "values");
    }
    entries() {
      return new QueryIterator(queryState(this), "entries");
    }
    // Web IDL excludes optional arguments from the exposed function length.
    // oxlint-disable-next-line typescript/no-useless-default-assignment
    forEach(callback: unknown, thisArg: unknown = undefined): void {
      const state = queryState(this);
      required(1, arguments.length);
      if (typeof callback !== "function") throw new TypeError("Callback must be callable");
      for (let index = 0; index < state.pairs.length; index++) {
        const pair = state.pairs[index];
        if (pair) Reflect.apply(callback, thisArg, [pair[1], pair[0], this]);
      }
    }
  }
  Object.defineProperty(URLSearchParams.prototype, Symbol.iterator, {
    value: Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "entries")?.value,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URLSearchParams.prototype, Symbol.toStringTag, {
    value: "URLSearchParams",
    configurable: true,
  });
  function parseURL(input: unknown, base: unknown, actual: number): string | null {
    required(1, actual);
    const converted = usvString(input),
      fallback = base === undefined ? "" : usvString(base);
    if (base !== undefined && linkValue("parse", "", fallback, "") === null) return null;
    return linkValue("parse", "", converted, fallback);
  }
  class URL {
    // Web IDL excludes optional arguments from the exposed function length.
    // oxlint-disable-next-line typescript/no-useless-default-assignment
    constructor(input: unknown, base: unknown = undefined) {
      const parsedURL = parseURL(input, base, arguments.length);
      if (parsedURL === null) throw new TypeError("Invalid URL");
      const params = new URLSearchParams(linkValue("get", "search", parsedURL, "") ?? "");
      urlStates.set(this, { href: parsedURL, params });
      queryState(params).owner = this;
    }
    // Web IDL excludes optional arguments from the exposed function length.
    // oxlint-disable-next-line typescript/no-useless-default-assignment
    static canParse(input: unknown, base: unknown = undefined): boolean {
      return parseURL(input, base, arguments.length) !== null;
    }
    // Web IDL excludes optional arguments from the exposed function length.
    // oxlint-disable-next-line typescript/no-useless-default-assignment
    static parse(input: unknown, base: unknown = undefined): URL | null {
      const parsedURL = parseURL(input, base, arguments.length);
      return parsedURL === null ? null : new URL(parsedURL);
    }
    get href(): string {
      return urlState(this).href;
    }
    set href(value: unknown) {
      const state = urlState(this),
        next = parseURL(value, undefined, 1);
      if (next === null) throw new TypeError("Invalid URL");
      const pairs = queryParse(linkValue("get", "search", next, "")?.replace(/^\?/, "") ?? "");
      state.href = next;
      queryState(state.params).pairs = pairs;
    }
    get origin(): string {
      return linkValue("get", "origin", urlState(this).href, "") ?? "null";
    }
    get searchParams(): URLSearchParams {
      return urlState(this).params;
    }
    toString(): string {
      return urlState(this).href;
    }
    toJSON(): string {
      return urlState(this).href;
    }
  }
  Object.defineProperty(URL.prototype, Symbol.toStringTag, { value: "URL", configurable: true });
  for (const property of [
    "protocol",
    "username",
    "password",
    "host",
    "hostname",
    "port",
    "pathname",
    "search",
    "hash",
  ]) {
    Object.defineProperty(URL.prototype, property, {
      get(this: URL): string {
        return linkValue("get", property, urlState(this).href, "") ?? "";
      },
      set(this: URL, value: unknown): void {
        const state = urlState(this),
          next = linkValue("set", property, state.href, "", usvString(value));
        if (next !== null) {
          const pairs =
            property === "search"
              ? queryParse((linkValue("get", "search", next, "") ?? "").replace(/^\?/, ""))
              : undefined;
          state.href = next;
          if (pairs) queryState(state.params).pairs = pairs;
        }
      },
      enumerable: true,
      configurable: true,
    });
  }
  for (const property of [
    "protocol",
    "username",
    "password",
    "host",
    "hostname",
    "port",
    "pathname",
    "search",
    "hash",
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(URL.prototype, property);
    if (descriptor) {
      for (const kind of ["get", "set"]) {
        const accessor: unknown = Reflect.get(descriptor, kind);
        if (typeof accessor === "function")
          Object.defineProperty(accessor, "name", {
            value: `${kind} ${property}`,
            configurable: true,
          });
      }
    }
  }
  for (const prototype of [URL, URL.prototype, URLSearchParams.prototype]) {
    for (const property of Object.getOwnPropertyNames(prototype)) {
      if (
        property === "constructor" ||
        property === "length" ||
        property === "name" ||
        property === "prototype"
      )
        continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (descriptor)
        Object.defineProperty(prototype, property, { ...descriptor, enumerable: true });
    }
  }

  function documentBase(): string {
    return linkValue("base", "", raw<string | null>("baseHref", 0), href) ?? href;
  }
  const anchors = new WeakSet<object>();
  function anchorId(owner: object): number {
    if (!anchors.has(owner)) throw new TypeError("Illegal invocation");
    return idOf(owner);
  }
  function anchorAttribute(owner: object, attribute: string): string {
    return call<string | null>("attr", anchorId(owner), attribute) ?? "";
  }
  function anchorUrl(owner: object, property: string): string {
    const input = call<string | null>("attr", anchorId(owner), "href");
    return linkValue("get", property, input, documentBase()) ?? "";
  }
  function setAnchorUrl(owner: object, property: string, value: unknown): void {
    const id = anchorId(owner);
    const converted = usvString(value);
    const input = call<string | null>("attr", id, "href");
    const next = linkValue("set", property, input, documentBase(), converted);
    if (next !== null) call("setAttr", id, "href", next);
  }
  class HTMLStyleElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
    }
    get sheet(): CSSStyleSheet | null {
      if (!(this instanceof HTMLStyleElement)) throw new TypeError("Illegal invocation");
      const id = call<number | null>("styleSheet", idOf(this));
      if (id === null) return null;
      return cssSheetWrapper(id);
    }
  }
  Object.defineProperty(HTMLStyleElement.prototype, Symbol.toStringTag, {
    value: "HTMLStyleElement",
    configurable: true,
  });
  Object.defineProperty(HTMLStyleElement.prototype, "sheet", {
    ...Object.getOwnPropertyDescriptor(HTMLStyleElement.prototype, "sheet"),
    enumerable: true,
  });
  class HTMLLinkElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
    }
    get href(): string {
      if (!(this instanceof HTMLLinkElement)) throw new TypeError("Illegal invocation");
      const value = call<string | null>("attr", idOf(this), "href");
      return linkValue("get", "href", value, documentBase()) ?? "";
    }
    set href(value: unknown) {
      if (!(this instanceof HTMLLinkElement)) throw new TypeError("Illegal invocation");
      call("setAttr", idOf(this), "href", usvString(value));
    }
    get sheet(): CSSStyleSheet | null {
      if (!(this instanceof HTMLLinkElement)) throw new TypeError("Illegal invocation");
      const id = call<number | null>("styleSheet", idOf(this));
      return id === null ? null : cssSheetWrapper(id);
    }
  }
  Object.defineProperty(HTMLLinkElement.prototype, Symbol.toStringTag, {
    value: "HTMLLinkElement",
    configurable: true,
  });
  Object.defineProperty(HTMLLinkElement.prototype, "sheet", {
    ...Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, "sheet"),
    enumerable: true,
  });
  for (const [ownerClass, attributes] of [
    [HTMLStyleElement, ["type", "media"]],
    [HTMLLinkElement, ["type", "media", "rel", "hreflang"]],
  ] as const) {
    for (const attribute of attributes)
      Object.defineProperty(ownerClass.prototype, attribute, {
        get(this: object): string {
          if (!(this instanceof ownerClass)) throw new TypeError("Illegal invocation");
          return call<string | null>("attr", idOf(this), attribute) ?? "";
        },
        set(this: object, value: unknown) {
          if (!(this instanceof ownerClass)) throw new TypeError("Illegal invocation");
          call("setAttr", idOf(this), attribute, domString(value));
        },
        enumerable: true,
        configurable: true,
      });
  }
  class HTMLAnchorElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      anchors.add(this);
    }
    get href(): string {
      return anchorUrl(this, "href");
    }
    set href(value: unknown) {
      const id = anchorId(this);
      call("setAttr", id, "href", usvString(value));
    }
    get origin(): string {
      return anchorUrl(this, "origin");
    }
    get text(): string {
      return call<string | null>("get", anchorId(this), "textContent") ?? "";
    }
    set text(value: unknown) {
      call("set", anchorId(this), "textContent", domString(value));
    }
    get ping(): string {
      return usvString(anchorAttribute(this, "ping"));
    }
    set ping(value: unknown) {
      call("setAttr", anchorId(this), "ping", usvString(value));
    }
    get referrerPolicy(): string {
      const value = anchorAttribute(this, "referrerpolicy").replace(/[A-Z]/g, (character) =>
        character.toLowerCase(),
      );
      return [
        "no-referrer",
        "no-referrer-when-downgrade",
        "same-origin",
        "origin",
        "strict-origin",
        "origin-when-cross-origin",
        "strict-origin-when-cross-origin",
        "unsafe-url",
      ].includes(value)
        ? value
        : "";
    }
    set referrerPolicy(value: unknown) {
      call("setAttr", anchorId(this), "referrerpolicy", domString(value));
    }
    get relList(): DOMTokenList {
      anchorId(this);
      return classList(this, "rel");
    }
    set relList(value: unknown) {
      anchorId(this);
      this.relList.value = value;
    }
    override toString(): string {
      return anchorUrl(this, "href");
    }
  }
  Object.defineProperty(HTMLAnchorElement.prototype, Symbol.toStringTag, {
    value: "HTMLAnchorElement",
    configurable: true,
  });
  const iframes = new WeakSet<object>();
  function iframeId(owner: object): number {
    if (!iframes.has(owner)) throw new TypeError("Illegal invocation");
    return idOf(owner);
  }
  class HTMLIFrameElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      iframes.add(this);
    }
    get src(): string {
      const value = call<string | null>("attr", iframeId(this), "src");
      return linkValue("get", "href", value, documentBase()) ?? "";
    }
    set src(value: unknown) {
      call("setAttr", iframeId(this), "src", usvString(value));
    }
    get contentWindow(): null {
      if (call<boolean>("get", iframeId(this), "isConnected"))
        throw new DOMException(
          "Independent frame contexts are not implemented",
          "NotSupportedError",
        );
      return null;
    }
    get contentDocument(): null {
      iframeId(this);
      return this.contentWindow;
    }
    get allowFullscreen(): boolean {
      return call<string | null>("attr", iframeId(this), "allowfullscreen") !== null;
    }
    set allowFullscreen(value: unknown) {
      call(value ? "setAttr" : "removeAttr", iframeId(this), "allowfullscreen");
    }
  }
  Object.defineProperty(HTMLIFrameElement.prototype, Symbol.toStringTag, {
    value: "HTMLIFrameElement",
    configurable: true,
  });
  for (const attribute of ["srcdoc", "name", "width", "height", "allow"]) {
    Object.defineProperty(HTMLIFrameElement.prototype, attribute, {
      get(this: HTMLIFrameElement): string {
        return call<string | null>("attr", iframeId(this), attribute) ?? "";
      },
      set(this: HTMLIFrameElement, value: unknown): void {
        call("setAttr", iframeId(this), attribute, domString(value));
      },
      enumerable: true,
      configurable: true,
    });
  }
  for (const attribute of [
    "target",
    "download",
    "rel",
    "hreflang",
    "type",
    "name",
    "charset",
    "coords",
    "shape",
    "rev",
  ]) {
    Object.defineProperty(HTMLAnchorElement.prototype, attribute, {
      get(this: object): string {
        return anchorAttribute(this, attribute);
      },
      set(this: object, value: unknown) {
        call("setAttr", anchorId(this), attribute, domString(value));
      },
      enumerable: true,
      configurable: true,
    });
  }
  for (const property of [
    "protocol",
    "username",
    "password",
    "host",
    "hostname",
    "port",
    "pathname",
    "search",
    "hash",
  ]) {
    Object.defineProperty(HTMLAnchorElement.prototype, property, {
      get(this: object): string {
        return anchorUrl(this, property);
      },
      set(this: object, value: unknown) {
        setAnchorUrl(this, property, value);
      },
      enumerable: true,
      configurable: true,
    });
  }

  type CustomConstructor = new () => HTMLElement;
  type CustomCallback = (this: HTMLElement, ...args: unknown[]) => unknown;
  type Definition = {
    name: string;
    constructor: CustomConstructor;
    prototype: object;
    observed: string[];
    callbacks: Map<string, CustomCallback>;
    stack: { element: HTMLElement; consumed: boolean }[];
  };
  type CustomState = { definition: Definition; status: "constructing" | "custom" | "failed" };
  const definitions = new Map<string, Definition>();
  const constructorDefinitions = new Map<Function, Definition>();
  const customStates = new WeakMap<HTMLElement, CustomState>();
  const reactionQueues = new WeakMap<HTMLElement, (() => void)[]>();
  const reactionFrames: Set<HTMLElement>[] = [];
  const pendingDefinitions = new Map<
    string,
    { promise: Promise<CustomConstructor>; resolve: (constructor: CustomConstructor) => void }
  >();
  const registryBrands = new WeakSet<object>();
  let defining = false;
  function validCustomName(name: string): boolean {
    return (
      /^[a-z]/.test(name) &&
      name.includes("-") &&
      !/[A-Z\t\n\f\r \0/>]/.test(name) &&
      ![
        "annotation-xml",
        "color-profile",
        "font-face",
        "font-face-src",
        "font-face-uri",
        "font-face-format",
        "font-face-name",
        "missing-glyph",
      ].includes(name)
    );
  }
  function registryBrand(registry: object): void {
    if (!registryBrands.has(registry)) throw new TypeError("Illegal invocation");
  }
  function reactions<T>(work: () => T): T {
    const frame = new Set<HTMLElement>();
    reactionFrames.push(frame);
    try {
      return work();
    } finally {
      reactionFrames.pop();
      for (const target of frame) {
        const queue = reactionQueues.get(target);
        for (let reaction = queue?.shift(); reaction; reaction = queue?.shift()) {
          try {
            reaction();
          } catch (error) {
            reportListenerError(error);
          }
        }
      }
    }
  }
  function enqueue(target: HTMLElement, reaction: () => void): void {
    let queue = reactionQueues.get(target);
    if (!queue) {
      queue = [];
      reactionQueues.set(target, queue);
    }
    queue.push(reaction);
    const frame = reactionFrames.at(-1);
    if (!frame) throw new Error("missing custom-element reaction frame");
    frame.add(target);
  }
  function customCallback(target: HTMLElement, name: string, args: unknown[] = []): void {
    const state = customStates.get(target);
    const handler = state?.definition.callbacks.get(name);
    if (!state || state.status === "failed" || !handler) return;
    if (name === "attributeChangedCallback" && !state.definition.observed.includes(String(args[0])))
      return;
    enqueue(target, () => {
      if (state.status !== "failed") handler.apply(target, args);
    });
  }
  function customTree(root: number, inclusive = true, name = ""): HTMLElement[] {
    return raw<number[]>("customCandidates", root, name)
      .filter((id) => inclusive || id !== root)
      .map(element)
      .filter(isHTML);
  }
  function upgrade(target: HTMLElement): void {
    reactions(() => upgradeElement(target));
  }
  function upgradeElement(target: HTMLElement): void {
    if (customStates.has(target)) return;
    const definition = definitions.get(raw<string>("get", idOf(target), "localName"));
    if (!definition) return;
    const state: CustomState = { definition, status: "constructing" };
    customStates.set(target, state);
    for (const [name, value, namespace] of raw<[string, string, string | null][]>(
      "attributes",
      idOf(target),
    ))
      customCallback(target, "attributeChangedCallback", [name, null, value, namespace]);
    if (raw<boolean>("get", idOf(target), "isConnected"))
      customCallback(target, "connectedCallback");
    const entry = { element: target, consumed: false };
    definition.stack.push(entry);
    try {
      const result = Reflect.construct(definition.constructor, []);
      if (result !== target || !entry.consumed)
        throw new TypeError("custom constructor did not return its native element");
      state.status = "custom";
    } catch (error) {
      state.status = "failed";
      reactionQueues.get(target)?.splice(0);
      reportListenerError(error);
    } finally {
      definition.stack.pop();
    }
  }
  function constructHTML(constructor: Function): HTMLElement {
    const definition = constructorDefinitions.get(constructor);
    if (!definition || constructor === HTMLElement) throw new TypeError("Illegal constructor");
    const entry = definition.stack.at(-1);
    if (entry) {
      if (entry.consumed)
        throw new DOMException("element already constructed", "InvalidStateError");
      entry.consumed = true;
      Object.setPrototypeOf(entry.element, definition.prototype);
      return entry.element;
    }
    const target = new HTMLElement(internal, raw<number>("create", 0, definition.name));
    Object.setPrototypeOf(target, definition.prototype);
    customStates.set(target, { definition, status: "custom" });
    return target;
  }
  function stringSequence(value: unknown): string[] {
    if (value === undefined) return [];
    if (value === null || (typeof value !== "object" && typeof value !== "function"))
      throw new TypeError("expected an iterable object");
    // The iterable conversion is checked by Array.from's iterator handling.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const iterable = value as Iterable<unknown>;
    if (typeof iterable[Symbol.iterator] !== "function")
      throw new TypeError("expected an iterable object");
    return Array.from(iterable, domString);
  }
  class CustomElementRegistry {
    constructor(key?: symbol) {
      if (key !== internal)
        throw new DOMException("scoped registries are not implemented", "NotSupportedError");
      registryBrands.add(this);
    }
    define(
      name: unknown,
      constructor: unknown,
      options: { extends?: unknown } | null = null,
    ): void {
      registryBrand(this);
      if (arguments.length < 2) throw new TypeError("define requires a name and constructor");
      const localName = domString(name);
      if (typeof constructor !== "function")
        throw new TypeError("constructor must be constructable");
      try {
        Reflect.construct(new Proxy(constructor, { construct: () => ({}) }), []);
      } catch {
        throw new TypeError("constructor must be constructable");
      }
      if (!validCustomName(localName))
        throw new DOMException("invalid custom element name", "SyntaxError");
      if (definitions.has(localName) || constructorDefinitions.has(constructor))
        throw new DOMException("duplicate custom element definition", "NotSupportedError");
      const extended = options?.extends;
      if (extended !== undefined) {
        domString(extended);
        throw new DOMException(
          "customized built-in elements are not implemented",
          "NotSupportedError",
        );
      }
      if (defining) throw new DOMException("definition is running", "NotSupportedError");
      if (definitions.size >= 1024) throw new Error("custom element definition limit");
      defining = true;
      let prototype: object;
      const callbacks = new Map<string, CustomCallback>();
      let observed: string[];
      try {
        const candidate: unknown = constructor.prototype;
        if (
          candidate === null ||
          (typeof candidate !== "object" && typeof candidate !== "function")
        )
          throw new TypeError("constructor prototype must be an object");
        prototype = candidate;
        for (const callbackName of [
          "connectedCallback",
          "disconnectedCallback",
          "connectedMoveCallback",
          "adoptedCallback",
          "attributeChangedCallback",
        ]) {
          const handler: unknown = Reflect.get(prototype, callbackName);
          if (handler !== undefined) {
            if (typeof handler !== "function")
              throw new TypeError("lifecycle callback must be callable");
            // Callability was checked above; callbacks execute only in the page realm.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            callbacks.set(callbackName, handler as CustomCallback);
          }
        }
        observed = callbacks.has("attributeChangedCallback")
          ? stringSequence(Reflect.get(constructor, "observedAttributes"))
          : [];
        stringSequence(Reflect.get(constructor, "disabledFeatures"));
        if (Reflect.get(constructor, "formAssociated"))
          throw new DOMException(
            "form-associated custom elements are not implemented",
            "NotSupportedError",
          );
      } finally {
        defining = false;
      }
      // Constructability and prototype shape were checked without invoking user construction.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const customConstructor = constructor as CustomConstructor;
      const definition: Definition = {
        name: localName,
        constructor: customConstructor,
        prototype,
        callbacks,
        observed,
        stack: [],
      };
      reactions(() => {
        definitions.set(localName, definition);
        constructorDefinitions.set(constructor, definition);
        for (const target of customTree(0, true, localName)) enqueue(target, () => upgrade(target));
        pendingDefinitions.get(localName)?.resolve(definition.constructor);
        pendingDefinitions.delete(localName);
      });
    }
    get(name: unknown): CustomConstructor | undefined {
      registryBrand(this);
      if (arguments.length === 0) throw new TypeError("get requires a name");
      return definitions.get(domString(name))?.constructor;
    }
    getName(constructor: unknown): string | null {
      registryBrand(this);
      if (typeof constructor !== "function") throw new TypeError("getName requires a constructor");
      return constructorDefinitions.get(constructor)?.name ?? null;
    }
    whenDefined(name: unknown): Promise<CustomConstructor> {
      try {
        registryBrand(this);
        if (arguments.length === 0) throw new TypeError("whenDefined requires a name");
        const localName = domString(name);
        if (!validCustomName(localName))
          throw new DOMException("invalid custom element name", "SyntaxError");
        const defined = definitions.get(localName);
        if (defined) return Promise.resolve(defined.constructor);
        const pending = pendingDefinitions.get(localName);
        if (pending) return pending.promise;
        if (pendingDefinitions.size >= 1024) throw new Error("when-defined promise limit");
        let resolve!: (constructor: CustomConstructor) => void;
        const promise = new Promise<CustomConstructor>((done) => {
          resolve = done;
        });
        pendingDefinitions.set(localName, { promise, resolve });
        return promise;
      } catch (error) {
        return Promise.reject(error);
      }
    }
    upgrade(root: Node): void {
      registryBrand(this);
      const id = idOf(root);
      reactions(() => {
        for (const target of customTree(id)) enqueue(target, () => upgrade(target));
      });
    }
  }
  Object.defineProperty(CustomElementRegistry.prototype, Symbol.toStringTag, {
    value: "CustomElementRegistry",
    configurable: true,
  });
  const customElements = new CustomElementRegistry(internal);
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  function customMutation<T>(
    operation: string,
    id: number,
    arg: string,
    value: string,
    deferred = false,
  ): T {
    if (
      definitions.size === 0 ||
      ![
        "setAttr",
        "removeAttr",
        "style",
        "set",
        "append",
        "insert",
        "replace",
        "remove",
        "removeChild",
      ].includes(operation)
    )
      return raw<T>(operation, id, arg, value);
    const mutate = () => {
      if (operation === "style") {
        const target = nodes.get(id);
        const old = raw<string | null>("attr", id, "style");
        const result = raw<StyleOutput>(operation, id, arg, value);
        if (target && isHTML(target) && (arg === "text" || result.changed)) {
          customCallback(target, "attributeChangedCallback", ["style", old, result.css_text, null]);
        }
        // Rust owns the result shape for this operation.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return result as T;
      }
      if (operation === "setAttr" || operation === "removeAttr") {
        const target = nodes.get(id);
        const old = raw<string | null>("attr", id, arg);
        const result = raw<T>(operation, id, arg, value);
        if (target && isHTML(target) && (operation === "setAttr" || old !== null)) {
          customCallback(target, "attributeChangedCallback", [
            arg,
            old,
            operation === "removeAttr" ? null : value,
            null,
          ]);
        }
        return result;
      }
      if (operation === "set" && !["innerHTML", "textContent"].includes(arg))
        return raw<T>(operation, id, arg, value);
      if (operation === "set" && ![1, 11].includes(raw<number>("get", id, "nodeType")))
        return raw<T>(operation, id, arg, value);
      const insertion = ["append", "insert", "replace"].includes(operation);
      const replacedContents = operation === "set";
      const source = insertion || operation === "removeChild" ? Number(value) : id;
      let before = replacedContents ? customTree(id, false) : customTree(source);
      if (operation === "replace" && Number(arg) !== source)
        before.push(...customTree(Number(arg)));
      before = Array.from(new Set(before));
      const connected = before.filter(
        (target) =>
          raw<boolean>("get", idOf(target), "isConnected") &&
          customStates.get(target)?.status === "custom",
      );
      const result = raw<T>(operation, id, arg, value);
      for (const target of connected) customCallback(target, "disconnectedCallback");
      const after = replacedContents ? customTree(id, false) : before;
      for (const target of after) {
        if (customStates.get(target)?.status === "custom") {
          if (raw<boolean>("get", idOf(target), "isConnected"))
            customCallback(target, "connectedCallback");
        } else if (replacedContents || raw<boolean>("get", idOf(target), "isConnected"))
          enqueue(target, () => upgrade(target));
      }
      return result;
    };
    return deferred ? mutate() : reactions(mutate);
  }
  class CharacterData extends Node {
    before(...values: unknown[]): void {
      if (!(this instanceof CharacterData)) throw new TypeError("Illegal invocation");
      childOperation(this, "before", values);
    }
    after(...values: unknown[]): void {
      if (!(this instanceof CharacterData)) throw new TypeError("Illegal invocation");
      childOperation(this, "after", values);
    }
    replaceWith(...values: unknown[]): void {
      if (!(this instanceof CharacterData)) throw new TypeError("Illegal invocation");
      childOperation(this, "replaceWith", values);
    }

    get data(): string {
      return this.nodeValue ?? "";
    }
    set data(value: string) {
      this.nodeValue = value;
    }
    get length(): number {
      return this.data.length;
    }
  }
  class DocumentType extends Node {
    before(...values: unknown[]): void {
      if (!(this instanceof DocumentType)) throw new TypeError("Illegal invocation");
      childOperation(this, "before", values);
    }
    after(...values: unknown[]): void {
      if (!(this instanceof DocumentType)) throw new TypeError("Illegal invocation");
      childOperation(this, "after", values);
    }
    replaceWith(...values: unknown[]): void {
      if (!(this instanceof DocumentType)) throw new TypeError("Illegal invocation");
      childOperation(this, "replaceWith", values);
    }
  }
  class Text extends CharacterData {
    constructor(data: string | number | null = "", key?: symbol, id?: number) {
      super(
        internal,
        key === internal && id !== undefined ? id : call("createText", 0, "", String(data)),
      );
    }
  }
  class Comment extends CharacterData {
    constructor(data: string | number | null = "", key?: symbol, id?: number) {
      super(
        internal,
        key === internal && id !== undefined ? id : call("createComment", 0, "", String(data)),
      );
    }
  }
  function node(id: number): Node {
    const existing = nodes.get(id);
    if (existing) return existing;
    switch (call<number>("get", id, "nodeType")) {
      case 1: {
        const namespace = call<string | null>("get", id, "namespaceURI");
        if (namespace === "http://www.w3.org/1999/xhtml") {
          const name = call<string>("get", id, "localName");
          if (name === "style") return new HTMLStyleElement(internal, id);
          if (name === "a") return new HTMLAnchorElement(internal, id);
          if (name === "link") return new HTMLLinkElement(internal, id);
          if (name === "iframe") return new HTMLIFrameElement(internal, id);
          return new HTMLElement(internal, id);
        }
        return namespace === "http://www.w3.org/2000/svg"
          ? new SVGElement(internal, id)
          : new Element(internal, id);
      }
      case 3:
        return new Text("", internal, id);
      case 8:
        return new Comment("", internal, id);
      case 10:
        return new DocumentType(internal, id);
      case 11:
        return new DocumentFragment(internal, id);
      default:
        return new Node(internal, id);
    }
  }

  class DocumentFragment extends ParentNode {
    append(...values: unknown[]): void {
      if (!(this instanceof DocumentFragment)) throw new TypeError("Illegal invocation");
      parentOperation(this, false, values);
    }
    prepend(...values: unknown[]): void {
      if (!(this instanceof DocumentFragment)) throw new TypeError("Illegal invocation");
      parentOperation(this, true, values);
    }

    constructor(key?: symbol, id?: number) {
      super(internal, key === internal && id !== undefined ? id : call("createFragment", 0));
    }
  }
  function element(id: number): Element {
    const result = node(id);
    if (!(result instanceof Element)) throw new TypeError("expected Element");
    return result;
  }

  for (const prototype of [
    Element.prototype,
    CharacterData.prototype,
    DocumentType.prototype,
    DocumentFragment.prototype,
  ]) {
    const unscopables: Record<string, boolean> = {};
    Object.setPrototypeOf(unscopables, null);
    for (const key of ["append", "prepend", "before", "after", "replaceWith", "remove"]) {
      if (key in prototype) unscopables[key] = true;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (descriptor) Object.defineProperty(prototype, key, { ...descriptor, enumerable: true });
    }
    Object.defineProperty(prototype, Symbol.unscopables, {
      value: unscopables,
      configurable: true,
    });
  }
  Object.defineProperty(ParentNode.prototype, Symbol.unscopables, {
    value: Object.assign(Object.create(null), { append: true, prepend: true }),
    configurable: true,
  });
  Object.defineProperty(DocumentType.prototype, Symbol.toStringTag, {
    value: "DocumentType",
    configurable: true,
  });

  let readyState = "loading";
  const adoptedTarget: CSSStyleSheet[] = [];
  function commitAdoption(next: CSSStyleSheet[]): void {
    const sheetIds = next.map((sheet) => cssSheetId(sheet));
    cssomCall("adopt", 0, "", JSON.stringify(sheetIds));
    adoptedTarget.splice(0, adoptedTarget.length, ...next);
  }
  function adoptionIndex(key: PropertyKey): number | undefined {
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)) return undefined;
    const index = Number(key);
    return index < 4294967295 ? index : undefined;
  }
  function adoptionSet(key: PropertyKey, value: unknown): boolean {
    if (key === "length") {
      const next = adoptedTarget.slice();
      Reflect.set(next, "length", value);
      if (next.length > adoptedTarget.length) return false;
      commitAdoption(next);
      return true;
    }
    const index = adoptionIndex(key);
    if (index === undefined) return Reflect.set(adoptedTarget, key, value);
    if (index > adoptedTarget.length) return false;
    if (!(value instanceof CSSStyleSheet)) throw new TypeError("Expected CSSStyleSheet");
    cssSheetId(value);
    const next = adoptedTarget.slice();
    next[index] = value;
    commitAdoption(next);
    return true;
  }
  const adoptedSheets = new Proxy(adoptedTarget, {
    set(_target, key, value: unknown) {
      return adoptionSet(key, value);
    },
    deleteProperty(target, key) {
      const index = adoptionIndex(key);
      if (index === undefined)
        return key === "length" ? false : Reflect.deleteProperty(target, key);
      if (index >= target.length) return true;
      if (index !== target.length - 1) return false;
      commitAdoption(target.slice(0, -1));
      return true;
    },
    defineProperty(target, key, descriptor) {
      if (key !== "length" && adoptionIndex(key) === undefined)
        return Reflect.defineProperty(target, key, descriptor);
      if (
        descriptor.get ||
        descriptor.set ||
        descriptor.configurable === false ||
        descriptor.enumerable === false ||
        descriptor.writable === false
      )
        return false;
      return "value" in descriptor ? adoptionSet(key, descriptor.value) : true;
    },
    preventExtensions() {
      return false;
    },
  });
  class Document extends ParentNode {
    get cookie(): string {
      if (this !== document) throw new TypeError("Illegal invocation");
      return nativeCookie(false, "");
    }
    set cookie(value: unknown) {
      if (this !== document) throw new TypeError("Illegal invocation");
      nativeCookie(true, domString(value));
    }

    getElementsByTagName(qualifiedName: unknown): HTMLCollection {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      required(1, arguments.length);
      return tagElements(this, qualifiedName);
    }

    get styleSheets(): StyleSheetList {
      if (this !== document) throw new TypeError("Illegal invocation");
      let list = documentSheetLists.get(this);
      if (!list) {
        list = new StyleSheetList(internal, this);
        documentSheetLists.set(this, list);
      }
      return list;
    }
    get adoptedStyleSheets(): CSSStyleSheet[] {
      if (this !== document) throw new TypeError("Illegal invocation");
      return adoptedSheets;
    }
    set adoptedStyleSheets(value: Iterable<CSSStyleSheet>) {
      if (this !== document) throw new TypeError("Illegal invocation");
      if (value === null || value === undefined || typeof value[Symbol.iterator] !== "function")
        throw new TypeError("Expected iterable sheets");
      const next = Array.from(value);
      for (const sheet of next) cssSheetId(sheet);
      commitAdoption(next);
    }

    append(...values: unknown[]): void {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      parentOperation(this, false, values);
    }
    prepend(...values: unknown[]): void {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      parentOperation(this, true, values);
    }

    get body() {
      return this.querySelector("body");
    }
    get head() {
      return this.querySelector("head");
    }
    get documentElement() {
      return this.querySelector("html");
    }
    get readyState() {
      return readyState;
    }
    get visibilityState(): "visible" | "hidden" {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      // The active headless browsing context is foreground. Detached documents
      // retain the initial hidden state; background lifecycle is not exposed yet.
      return this === document ? "visible" : "hidden";
    }
    get hidden(): boolean {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      return this !== document;
    }
    get URL() {
      return href;
    }
    get documentURI() {
      return href;
    }
    get title() {
      return this.querySelector("title")?.textContent ?? "";
    }
    set title(value: string | number | null) {
      let title = this.querySelector("title");
      if (!title) {
        title = this.createElement("title");
        this.head?.appendChild(title);
      }
      title.textContent = value;
    }
    getElementById(id: string) {
      return this.querySelector(`[id=${JSON.stringify(id)}]`);
    }
    createTextNode(data: string) {
      return new Text(data);
    }
    createComment(data: string) {
      return new Comment(data);
    }
    createDocumentFragment() {
      return new DocumentFragment();
    }
    createElementNS(namespace: unknown, qualifiedName: unknown) {
      if (this !== document) throw new TypeError("Illegal invocation");
      if (arguments.length < 2) throw new TypeError("createElementNS requires namespace and name");
      const uri = namespace === null || namespace === undefined ? "" : domString(namespace);
      const name = domString(qualifiedName);
      return createdElement(() => call<number>("createNS", 0, name, uri));
    }
    createElement(tag: string) {
      if (arguments.length === 0) throw new TypeError("createElement requires a name");
      const localName = domString(tag);
      return createdElement(() => call<number>("create", 0, localName));
    }
  }
  function createdElement(create: () => number): Element {
    const target = element(create());
    if (isHTML(target) && definitions.size > 0) {
      const definition = definitions.get(raw<string>("get", idOf(target), "localName"));
      if (definition) {
        reactions(() => upgrade(target));
        const state = customStates.get(target);
        if (
          state?.status !== "custom" ||
          raw<unknown[]>("attributes", idOf(target)).length > 0 ||
          raw<number[]>("children", idOf(target), "nodes").length > 0 ||
          raw<number | null>("relativeNode", idOf(target), "parent") !== null
        ) {
          if (state?.status === "custom") {
            state.status = "failed";
            reportListenerError(
              new DOMException(
                "custom constructor changed initial DOM structure",
                "NotSupportedError",
              ),
            );
          }
          const fallback = new HTMLElement(internal, create());
          customStates.set(fallback, { definition, status: "failed" });
          return fallback;
        }
      }
    }
    return target;
  }
  for (const key of ["append", "prepend", "cookie", "hidden", "visibilityState"]) {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, key);
    if (descriptor)
      Object.defineProperty(Document.prototype, key, { ...descriptor, enumerable: true });
  }
  const document = new Document(internal, 0);
  nodes.set(0, document);
  targets.add(globalThis);

  type Timer = {
    handler: ((...args: unknown[]) => unknown) | string;
    args: unknown[];
    delay: number;
    due: number;
    level: number;
    repeat: boolean;
  };
  const timers = new Map<number, Timer>();
  const animationFrames = new Map<number, (time: number) => unknown>();
  // Headless rendering opportunities use the host's real monotonic clock.
  // Frames have their own handle namespace and snapshot, never timer aliases.
  const frameInterval = 1000 / 60;
  let nextFrame = 1;
  let frameDue = 0;
  let frameBatch: { handles: number[]; index: number; time: number } | undefined;
  function animationProvider(receiver: unknown) {
    if (receiver !== undefined && receiver !== null && receiver !== globalThis)
      throw new TypeError("Illegal invocation");
  }
  function requestAnimationFrame(this: unknown, callback: (time: number) => unknown) {
    animationProvider(this);
    if (typeof callback !== "function")
      throw new TypeError("requestAnimationFrame requires a function");
    if (timers.size + animationFrames.size >= timerLimit)
      throw new Error("animation frame capacity limit");
    if (!animationFrames.size && !frameBatch) frameDue = now() + frameInterval;
    const handle = nextFrame++;
    animationFrames.set(handle, callback);
    return handle;
  }
  function cancelAnimationFrame(this: unknown, handle: unknown) {
    animationProvider(this);
    if (arguments.length === 0) throw new TypeError("cancelAnimationFrame requires a handle");
    if (typeof handle === "bigint") throw new TypeError("BigInt is not an animation frame handle");
    animationFrames.delete(Number(handle) >>> 0);
  }
  function frameStep(): number {
    const batch = frameBatch;
    if (!batch) throw new Error("missing animation frame batch");
    while (batch.index < batch.handles.length) {
      const handle = batch.handles[batch.index++];
      if (handle === undefined) continue;
      const callback = animationFrames.get(handle);
      if (!callback) continue;
      if (timerTasks >= timerTaskLimit) throw new Error("timer task limit");
      timerTasks++;
      animationFrames.delete(handle);
      try {
        callback(batch.time);
      } catch (error) {
        reportListenerError(error);
      }
      // The machine drains microtasks between callbacks, preserving this snapshot.
      if (batch.index === batch.handles.length) frameBatch = undefined;
      return 0;
    }
    frameBatch = undefined;
    return 0;
  }
  // Timer strings execute as global scripts in this page's own QuickJS context.
  // oxlint-disable-next-line eslint/no-eval
  const executeScript = eval;
  let nextTimer = 1;
  let timerLevel = 0;
  let timerTasks = 0;
  function long(value: unknown): number {
    if (typeof value === "bigint") throw new TypeError("BigInt is not a timer number");
    return Number(value) | 0;
  }
  function schedule(handler: unknown, timeout: unknown, args: unknown[], repeat: boolean) {
    const callback = typeof handler === "function" ? handler : domString(handler);
    const delay = Math.max(0, long(timeout));
    if (timers.size + animationFrames.size >= timerLimit) throw new Error("timer capacity limit");
    const id = nextTimer++;
    timers.set(id, {
      // Callable values are validated above; arguments remain page-owned values.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      handler: callback as Timer["handler"],
      args,
      delay,
      due: now() + (timerLevel > 5 ? Math.max(4, delay) : delay),
      level: timerLevel + 1,
      repeat,
    });
    return id;
  }
  function setTimeout(handler: unknown, timeout: unknown = 0, ...args: unknown[]) {
    if (arguments.length === 0) throw new TypeError("setTimeout requires a handler");
    return schedule(handler, timeout, args, false);
  }
  function setInterval(handler: unknown, timeout: unknown = 0, ...args: unknown[]) {
    if (arguments.length === 0) throw new TypeError("setInterval requires a handler");
    return schedule(handler, timeout, args, true);
  }
  function clearTimeout(id: unknown) {
    if (arguments.length === 0) throw new TypeError("clearTimeout requires an id");
    timers.delete(long(id));
  }
  function queueMicrotask(callback: () => unknown) {
    if (typeof callback !== "function") throw new TypeError("queueMicrotask requires a function");
    void Promise.resolve().then(() => {
      try {
        callback();
      } catch (error) {
        reportListenerError(error);
      }
    });
  }
  function timer(run: boolean): number | null {
    if (!run) {
      timerLevel = 0;
      return null;
    }
    if (frameBatch) return frameStep();
    let selected: [number, Timer] | undefined;
    for (const entry of timers) {
      if (!selected || entry[1].due < selected[1].due) selected = entry;
    }
    if (animationFrames.size && (!selected || frameDue <= selected[1].due)) {
      const time = now();
      if (frameDue > time) return frameDue - time;
      frameBatch = { handles: Array.from(animationFrames.keys()), index: 0, time };
      frameDue = time + frameInterval;
      return frameStep();
    }
    if (!selected) return null;
    const [id, task] = selected;
    const delay = task.due - now();
    if (delay > 0) return delay;
    if (timerTasks >= timerTaskLimit) throw new Error("timer task limit");
    timerTasks++;
    timerLevel = task.level;
    try {
      if (typeof task.handler === "function") task.handler.apply(globalThis, task.args);
      else executeScript(task.handler);
    } catch (error) {
      reportListenerError(error);
    } finally {
      if (timers.get(id) === task) {
        if (task.repeat) {
          task.due = now() + (timerLevel > 5 ? Math.max(4, task.delay) : task.delay);
          task.level = timerLevel + 1;
        } else timers.delete(id);
      }
      // Keep the task nesting level until its microtask checkpoint completes.
    }
    return 0;
  }

  type ObserverMargin = { values: { value: number; percent: boolean }[]; css: string };
  type IntersectionGeometry = {
    rootBounds: RectValues;
    boundingClientRect: RectValues;
    intersectionRect: RectValues;
    intersectionRatio: number;
    isIntersecting: boolean;
  };
  type IntersectionEntryState = {
    time: number;
    rootBounds: DOMRectReadOnly | null;
    boundingClientRect: DOMRectReadOnly;
    intersectionRect: DOMRectReadOnly;
    intersectionRatio: number;
    isIntersecting: boolean;
    isVisible: boolean;
    target: Element;
  };
  const intersectionEntries = new WeakMap<IntersectionObserverEntry, IntersectionEntryState>();
  function entryState(entry: IntersectionObserverEntry): IntersectionEntryState {
    const state = intersectionEntries.get(entry);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  function finiteDouble(value: unknown): number {
    const number = rectNumber(value);
    if (!Number.isFinite(number)) throw new TypeError("Expected finite double");
    return number;
  }
  function observerElement(value: unknown): Element {
    if (!(value instanceof Element)) throw new TypeError("Expected Element");
    idOf(value);
    return value;
  }
  function initMember(init: object | null, key: string): unknown {
    return init === null ? undefined : Reflect.get(init, key);
  }
  function requiredMember(init: object | null, key: string): unknown {
    const value = initMember(init, key);
    if (value === undefined) throw new TypeError(`Missing required member: ${key}`);
    return value;
  }
  function entryRect(value: unknown): DOMRectReadOnly {
    const init = dictionary(value);
    return new DOMRectReadOnly(
      initMember(init, "x"),
      initMember(init, "y"),
      initMember(init, "width"),
      initMember(init, "height"),
    );
  }
  class IntersectionObserverEntry {
    constructor(options: unknown) {
      const init = encodingOptions(options);
      const boundingClientRect = entryRect(requiredMember(init, "boundingClientRect"));
      const intersectionRatio = finiteDouble(requiredMember(init, "intersectionRatio"));
      const intersectionRect = entryRect(requiredMember(init, "intersectionRect"));
      const isIntersecting = Boolean(requiredMember(init, "isIntersecting"));
      const isVisible = Boolean(initMember(init, "isVisible"));
      const bounds = initMember(init, "rootBounds");
      const rootBounds = bounds === undefined || bounds === null ? null : entryRect(bounds);
      const target = observerElement(requiredMember(init, "target"));
      const time = finiteDouble(requiredMember(init, "time"));
      intersectionEntries.set(this, {
        time,
        rootBounds,
        boundingClientRect,
        intersectionRect,
        intersectionRatio,
        isIntersecting,
        isVisible,
        target,
      });
    }
    get time() {
      return entryState(this).time;
    }
    get rootBounds() {
      return entryState(this).rootBounds;
    }
    get boundingClientRect() {
      return entryState(this).boundingClientRect;
    }
    get intersectionRect() {
      return entryState(this).intersectionRect;
    }
    get isIntersecting() {
      return entryState(this).isIntersecting;
    }
    get isVisible() {
      return entryState(this).isVisible;
    }
    get intersectionRatio() {
      return entryState(this).intersectionRatio;
    }
    get target() {
      return entryState(this).target;
    }
  }
  type IntersectionCallback = (
    this: IntersectionObserver,
    entries: IntersectionObserverEntry[],
    observer: IntersectionObserver,
  ) => unknown;
  type ObservedTarget = { threshold: number; intersects: boolean | null };
  type ObserverState = {
    callback: IntersectionCallback;
    root: Element | Document | null;
    margin: ObserverMargin;
    scrollMargin: ObserverMargin;
    thresholds: readonly number[];
    targets: Map<Element, ObservedTarget>;
    entries: IntersectionObserverEntry[];
    version: number;
  };
  const observers = new WeakMap<IntersectionObserver, ObserverState>();
  const activeObservers = new Set<IntersectionObserver>();
  const intersectionLimit = 1024;
  let observedTargets = 0;
  function observerState(observer: IntersectionObserver): ObserverState {
    const state = observers.get(observer);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  class IntersectionObserver {
    constructor(callback: unknown, options: unknown = {}) {
      if (typeof callback !== "function") throw new TypeError("Expected observer callback");
      const init = encodingOptions(options);
      const delay = initMember(init, "delay");
      const parsedDelay = delay === undefined ? 0 : long(delay);
      const rootValue = initMember(init, "root");
      let root: Element | Document | null = null;
      if (rootValue !== undefined && rootValue !== null) {
        if (rootValue === document) root = document;
        else root = observerElement(rootValue);
      }
      const marginValue = initMember(init, "rootMargin");
      const margin = raw<ObserverMargin>(
        "observerMargin",
        0,
        marginValue === undefined ? "0px" : domString(marginValue),
      );
      const scrollValue = initMember(init, "scrollMargin");
      const scrollMargin = raw<ObserverMargin>(
        "observerMargin",
        0,
        scrollValue === undefined ? "0px" : domString(scrollValue),
      );
      const threshold = initMember(init, "threshold");
      const thresholds: number[] = [];
      if (
        threshold !== undefined &&
        threshold !== null &&
        (typeof threshold === "object" || typeof threshold === "function")
      ) {
        const iterable: unknown = Reflect.get(threshold, Symbol.iterator);
        if (typeof iterable !== "function") throw new TypeError("Expected threshold sequence");
        // Web IDL validates the iterator before converting its yielded doubles.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        for (const value of threshold as Iterable<unknown>) {
          if (thresholds.length >= intersectionLimit)
            throw new Error("intersection threshold limit");
          thresholds.push(finiteDouble(value));
        }
      } else thresholds.push(finiteDouble(threshold === undefined ? 0 : threshold));
      if (thresholds.some((value) => value < 0 || value > 1))
        throw new RangeError("Threshold outside [0,1]");
      thresholds.sort((left, right) => left - right);
      if (thresholds.length === 0) thresholds.push(0);
      const trackVisibility = Boolean(initMember(init, "trackVisibility"));
      if (trackVisibility)
        throw new Error("intersection observation unsupported: visibility tracking");
      if (parsedDelay !== 0) throw new Error("intersection observation unsupported: delay");
      if (scrollMargin.values.some((value) => value.value !== 0))
        throw new Error("intersection observation unsupported: scroll margins");
      // The callback was validated as callable above; it remains page owned.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const observerCallback = callback as IntersectionCallback;
      observers.set(this, {
        callback: observerCallback,
        root,
        margin,
        scrollMargin,
        thresholds: Object.freeze(thresholds),
        targets: new Map(),
        entries: [],
        version: -1,
      });
    }
    get root() {
      return observerState(this).root;
    }
    get rootMargin() {
      return observerState(this).margin.css;
    }
    get scrollMargin() {
      return observerState(this).scrollMargin.css;
    }
    get thresholds() {
      return observerState(this).thresholds;
    }
    get delay() {
      observerState(this);
      return 0;
    }
    get trackVisibility() {
      observerState(this);
      return false;
    }
    observe(value: unknown): void {
      const state = observerState(this);
      const target = observerElement(value);
      if (state.targets.has(target)) return;
      if (
        observedTargets >= intersectionLimit ||
        (!activeObservers.has(this) && activeObservers.size >= intersectionLimit)
      )
        throw new Error("intersection registration limit");
      state.targets.set(target, { threshold: -1, intersects: null });
      observedTargets++;
      state.version = -1;
      activeObservers.add(this);
    }
    unobserve(value: unknown): void {
      const state = observerState(this);
      const target = observerElement(value);
      if (state.targets.delete(target)) observedTargets--;
      if (state.targets.size === 0) activeObservers.delete(this);
    }
    disconnect(): void {
      const state = observerState(this);
      observedTargets -= state.targets.size;
      state.targets.clear();
      activeObservers.delete(this);
    }
    takeRecords(): IntersectionObserverEntry[] {
      return observerState(this).entries.splice(0);
    }
  }
  for (const [prototype, tag] of [
    [IntersectionObserver.prototype, "IntersectionObserver"],
    [IntersectionObserverEntry.prototype, "IntersectionObserverEntry"],
  ] as const) {
    Object.defineProperty(prototype, Symbol.toStringTag, { value: tag, configurable: true });
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (descriptor) Object.defineProperty(prototype, key, { ...descriptor, enumerable: true });
    }
  }
  function intersections(): boolean {
    if (activeObservers.size === 0) return false;
    const version = raw<number>("layoutVersion", 0);
    const pending: IntersectionObserver[] = [];
    for (const observer of activeObservers) {
      const state = observerState(observer);
      if (state.version !== version) {
        for (const [target, previous] of state.targets) {
          const result = raw<IntersectionGeometry>(
            "observerMeasure",
            idOf(target),
            JSON.stringify({
              root: state.root === null ? null : idOf(state.root),
              margin: state.margin,
            }),
          );
          const threshold = state.thresholds.findIndex((value) => value > result.intersectionRatio);
          const index = threshold === -1 ? state.thresholds.length : threshold;
          if (index !== previous.threshold || result.isIntersecting !== previous.intersects) {
            state.entries.push(
              new IntersectionObserverEntry({ ...result, target, time: now(), isVisible: false }),
            );
            previous.threshold = index;
            previous.intersects = result.isIntersecting;
          }
        }
        state.version = version;
      }
      if (state.entries.length > 0) pending.push(observer);
    }
    if (pending.length === 0) return false;
    if (timerTasks >= timerTaskLimit) throw new Error("timer task limit");
    timerTasks++;
    for (const observer of pending) {
      const state = observerState(observer);
      const entries = state.entries.splice(0);
      if (entries.length === 0) continue;
      try {
        state.callback.call(observer, entries, observer);
      } catch (error) {
        reportListenerError(error);
      }
    }
    return true;
  }

  const responseKey = {};
  interface ResponseState extends NimboResponse {
    used: boolean;
  }
  const responses = new WeakMap<object, ResponseState>();
  const BodyBuffer = ArrayBuffer;
  // oxlint-disable-next-line typescript/unbound-method
  const decodeText = TextDecoder.prototype.decode;
  function responseState(value: object): ResponseState {
    const state = responses.get(value);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  function responseBody(value: object): ArrayBuffer {
    const state = responseState(value);
    if (state.used) throw new TypeError("Body has already been consumed");
    if (state.body === null) return new BodyBuffer(0);
    state.used = true;
    const length = bufferLength(state.body);
    if (typeof length !== "number") throw new TypeError("Invalid response buffer");
    const copy = new BodyBuffer(length);
    Reflect.apply(byteSet, new ByteArray(copy), [new ByteArray(state.body)]);
    return copy;
  }
  function responseText(value: object): string {
    const body = responseBody(value);
    const decoder = new TextDecoder();
    const length = bufferLength(body);
    if (typeof length !== "number") throw new TypeError("Invalid response buffer");
    let output = "";
    for (let offset = 0; offset < length; offset += 32_768) {
      output += Reflect.apply(decodeText, decoder, [
        new ByteArray(body, offset, Math.min(32_768, length - offset)),
        { stream: true },
      ]);
    }
    return output + Reflect.apply(decodeText, decoder, []);
  }
  class Response {
    constructor(key?: unknown, response?: NimboResponse) {
      if (key !== responseKey || response === undefined)
        throw new TypeError("Response construction is not implemented");
      responses.set(this, { ...response, used: false });
    }
    get status(): number {
      return responseState(this).status;
    }
    get ok(): boolean {
      const status = responseState(this).status;
      return status >= 200 && status < 300;
    }
    get url(): string {
      return responseState(this).url;
    }
    get bodyUsed(): boolean {
      return responseState(this).used;
    }
    get body(): never {
      responseState(this);
      throw new Error("response streams are not implemented");
    }
    get headers(): never {
      responseState(this);
      throw new Error("response headers are not implemented");
    }
    async arrayBuffer(): Promise<ArrayBuffer> {
      return responseBody(this);
    }
    async bytes(): Promise<Uint8Array> {
      return new ByteArray(responseBody(this));
    }
    async text(): Promise<string> {
      return responseText(this);
    }
    async json(): Promise<unknown> {
      return JSON.parse(responseText(this));
    }
    clone(): Response {
      const state = responseState(this);
      if (state.used) throw new TypeError("Body has already been consumed");
      return new Response(responseKey, state);
    }
  }
  Object.defineProperty(Response.prototype, Symbol.toStringTag, {
    value: "Response",
    configurable: true,
  });
  const fetch = async (url: string, options: { method?: string; body?: string } = {}) => {
    for (const key of Object.keys(options)) {
      if (!["method", "body"].includes(key)) throw new Error(`unsupported fetch option: ${key}`);
    }
    const method = (options.method ?? "GET").toUpperCase();
    if (method === "GET" && options.body !== undefined) throw new Error("GET cannot have a body");
    return new Response(responseKey, await nativeRequest(url, method, options.body ?? ""));
  };
  const fontDefaults = {
    style: "normal",
    weight: "normal",
    stretch: "normal",
    unicodeRange: "U+0-10FFFF",
    variant: "normal",
    featureSettings: "normal",
    variationSettings: "normal",
    display: "auto",
    ascentOverride: "normal",
    descentOverride: "normal",
    lineGapOverride: "normal",
    sizeAdjust: "100%",
  };
  type FontResource = { url: string | null; format: string | null; technology: boolean };
  type FontState = {
    family: string;
    status: "unloaded" | "loading" | "loaded" | "error";
    promise: Promise<FontFace>;
    resolve: (value: FontFace) => void;
    reject: (reason: unknown) => void;
    data: Uint8Array | null;
    resources: FontResource[] | null;
    descriptors: Record<string, string>;
    base: string;
  };
  const fontFaces = new WeakMap<object, FontState>();
  const FontPromise = Promise;
  function fontNoop(): void {}
  const fontReject = Promise.reject.bind(Promise);
  const fontAll = Promise.all.bind(Promise);
  // Internal status promises are marked handled, as required by CSS Font Loading.
  // oxlint-disable-next-line typescript/unbound-method
  const fontCatch = Promise.prototype.catch;
  function fontState(value: object): FontState {
    const state = fontFaces.get(value);
    if (!state) throw new TypeError("Illegal FontFace invocation");
    return state;
  }
  function fontBytes(input: unknown): Uint8Array {
    let buffer: unknown = input;
    let offset: unknown = 0;
    let length: unknown;
    if (isView(input)) {
      const typed = typedTag(input) !== undefined;
      buffer = (typed ? typedBuffer : dataBuffer)(input);
      offset = (typed ? typedOffset : dataOffset)(input);
      length = (typed ? typedLength : dataLength)(input);
    } else {
      length = bufferLength(input);
    }
    if (typeof length !== "number" || typeof offset !== "number")
      throw new TypeError("invalid font buffer");
    if (length > 1_048_576) throw new Error("font data limit");
    // The intrinsic constructors validate detachment; shared storage is unsupported.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const view = new ByteArray(buffer as ArrayBuffer, offset, length);
    if (sharedLength) {
      try {
        sharedLength(buffer);
        throw new Error("unsupported: shared font buffers");
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
      }
    }
    const copy = new ByteArray(length);
    Reflect.apply(byteSet, copy, [view]);
    return copy;
  }
  function fontDescriptor(name: string, value: unknown): string {
    const source = domString(value);
    if (["style", "weight", "stretch", "unicodeRange", "display"].includes(name)) {
      const parsed: unknown = JSON.parse(nativeFontMeta(name, source));
      if (typeof parsed === "string") return parsed;
      throw new DOMException("Invalid font descriptor", "SyntaxError");
    }
    const expected: unknown = Reflect.get(fontDefaults, name);
    if (source !== expected) throw new Error(`unsupported: font descriptor ${name}`);
    return source;
  }
  function failFont(state: FontState, reason: unknown): void {
    state.status = "error";
    state.reject(reason);
    fontSetSettled(state, false);
  }
  async function loadFont(owner: FontFace, state: FontState): Promise<void> {
    try {
      for (const resource of state.resources ?? []) {
        if (resource.url === null) continue; // No platform fonts are installed in this engine.
        if (resource.technology) throw new Error("unsupported: font source technology");
        if (resource.format !== null && !['"truetype"', '"opentype"'].includes(resource.format))
          continue;
        const url = linkValue("get", "href", resource.url, state.base) ?? resource.url;
        // Fallback sources must be requested in order, after the preceding source fails.
        // oxlint-disable-next-line eslint/no-await-in-loop
        const response = await nativeRequest(url, "GET", "");
        if (response.status < 200 || response.status >= 300 || response.body === null) continue;
        const data = fontBytes(response.body);
        if (!nativeFontData(data)) continue;
        state.data = data;
        state.status = "loaded";
        state.resolve(owner);
        fontSetSettled(state, true);
        return;
      }
      failFont(state, new DOMException("Font sources failed to load", "NetworkError"));
    } catch (error) {
      failFont(state, error);
    }
  }
  const PixelArray = Uint8ClampedArray;
  const pixelType = intrinsicGetter(typedPrototype, Symbol.toStringTag);
  const pixelResizable = intrinsicGetter(ArrayBuffer.prototype, "resizable");
  const canvasOwners = new WeakMap<
    object,
    { id: number; context: OffscreenCanvasRenderingContext2D | null }
  >();
  const drawingOwners = new WeakMap<
    object,
    { canvas: OffscreenCanvas; attributes: Record<string, unknown> }
  >();
  const imageOwners = new WeakMap<
    object,
    { data: Uint8ClampedArray; width: number; height: number }
  >();
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  function canvasCall<T>(operation: string, id: number, fields: Record<string, unknown> = {}): T {
    const value = nativeCanvas(JSON.stringify({ operation, id, ...fields }));
    if (typeof value !== "string") throw new Error("invalid canvas metadata");
    // The private Rust bridge serializes this validated result shape.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return JSON.parse(value) as T;
  }
  function canvasOwner(value: object) {
    const owner = canvasOwners.get(value);
    if (!owner) throw new TypeError("Illegal invocation");
    return owner;
  }
  function drawingOwner(value: object) {
    const owner = drawingOwners.get(value);
    if (!owner) throw new TypeError("Illegal invocation");
    return owner;
  }
  function canvasNumber(value: unknown): number {
    if (typeof value === "bigint") throw new TypeError("value must be a number");
    // Web IDL uses ToNumber, which also rejects objects coercing to BigInt.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-conversion
    return +(value as number);
  }
  function canvasInteger(value: unknown, minimum: number, maximum: number): number {
    const number = canvasNumber(value),
      integer = Math.trunc(number);
    if (!Number.isFinite(number) || integer < minimum || integer > maximum)
      throw new TypeError("canvas integer out of range");
    return integer;
  }
  function canvasDimension(value: unknown): number {
    const size = canvasInteger(value, 0, 18446744073709549568);
    if (size > 4096) throw new Error("canvas: dimensions limit");
    return size;
  }
  function imageSettings(settings: unknown): void {
    const value = encodingOptions(settings);
    const colorSpace = value.colorSpace === undefined ? "srgb" : domString(value.colorSpace);
    if (!["srgb", "display-p3"].includes(colorSpace)) throw new TypeError("invalid color space");
    if (colorSpace !== "srgb") throw new Error("unsupported: canvas color space");
    const format = value.pixelFormat === undefined ? "rgba-unorm8" : domString(value.pixelFormat);
    if (!["rgba-unorm8", "rgba-float16"].includes(format))
      throw new TypeError("invalid pixel format");
    if (format !== "rgba-unorm8") throw new Error("unsupported: canvas pixel format");
  }
  function canvasBytes(operation: string, id: number, rect: number[]): Uint8ClampedArray {
    const value = nativeCanvas(JSON.stringify({ operation, id, read: rect }));
    if (typeof value === "string") throw new Error("invalid canvas pixels");
    const result = new PixelArray(Number(typedLength(value)));
    Reflect.apply(byteSet, result, [value]);
    return result;
  }
  function imageInteger(value: unknown): number {
    const number = canvasNumber(value);
    if (!Number.isFinite(number) || number === 0) return 0;
    const integer = Math.trunc(number);
    return ((integer % 4294967296) + 4294967296) % 4294967296;
  }
  class ImageData {
    constructor(first: unknown, second: unknown, third?: unknown, fourth?: unknown) {
      if (arguments.length < 2) throw new TypeError("ImageData requires data or dimensions");
      let data: Uint8ClampedArray, width: number, height: number;
      if (isView(first) && pixelType(first) === "Float16Array")
        throw new Error("unsupported: canvas pixel format");
      if (isView(first) && pixelType(first) === "Uint8ClampedArray") {
        const buffer = typedBuffer(first);
        bufferLength(buffer);
        if (pixelResizable(buffer)) throw new TypeError("ImageData storage must not be resizable");
        const length = Number(typedLength(first));
        width = imageInteger(second);
        height = third === undefined ? length / (4 * width) : imageInteger(third);
        imageSettings(fourth);
        if (!length || length % 4)
          throw new DOMException("Invalid image storage", "InvalidStateError");
        if (!width || !Number.isInteger(height) || !height || length !== width * height * 4)
          throw new DOMException("Invalid ImageData dimensions", "IndexSizeError");
        if (width > 4096 || height > 4096 || width * height > 1048576)
          throw new Error("canvas: pixels limit");
        // The native typed-array intrinsic above establishes the exact array brand.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        data = first as Uint8ClampedArray;
      } else {
        width = imageInteger(first);
        height = imageInteger(second);
        imageSettings(third);
        if (!width || !height)
          throw new DOMException("Invalid ImageData dimensions", "IndexSizeError");
        data = canvasBytes("image", 0, [0, 0, width, height]);
      }
      imageOwners.set(this, { data, width, height });
    }
    get data(): Uint8ClampedArray {
      return imageOwner(this).data;
    }
    get width(): number {
      return imageOwner(this).width;
    }
    get height(): number {
      return imageOwner(this).height;
    }
    get colorSpace(): string {
      imageOwner(this);
      return "srgb";
    }
    get pixelFormat(): string {
      imageOwner(this);
      return "rgba-unorm8";
    }
  }
  function imageOwner(owner: object) {
    const result = imageOwners.get(owner);
    if (!result) throw new TypeError("Illegal invocation");
    return result;
  }
  function imageResult(data: Uint8ClampedArray, width: number, height: number): ImageData {
    // Only bounded native pixel operations can manufacture these branded objects.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const result = Object.create(ImageData.prototype) as ImageData;
    imageOwners.set(result, { data, width, height });
    return result;
  }
  function drawingState(owner: object): {
    fillStyle: string;
    globalAlpha: number;
    globalCompositeOperation: string;
  } {
    const drawing = drawingOwner(owner);
    return canvasCall("state", canvasOwner(drawing.canvas).id);
  }
  function rectangle(owner: object, operation: string, values: unknown[]): void {
    const drawing = drawingOwner(owner);
    if (values.length < 4) throw new TypeError("rectangle requires four arguments");
    const rect = values.slice(0, 4).map(canvasNumber);
    if (!rect.every(Number.isFinite)) return;
    canvasCall(operation, canvasOwner(drawing.canvas).id, { rect });
  }
  class OffscreenCanvasRenderingContext2D {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
    get canvas(): OffscreenCanvas {
      return drawingOwner(this).canvas;
    }
    get fillStyle(): string {
      return drawingState(this).fillStyle;
    }
    set fillStyle(value: unknown) {
      const owner = drawingOwner(this);
      canvasCall("fillStyle", canvasOwner(owner.canvas).id, { color: domString(value) });
    }
    get globalAlpha(): number {
      return drawingState(this).globalAlpha;
    }
    set globalAlpha(value: unknown) {
      const owner = drawingOwner(this),
        alpha = canvasNumber(value);
      if (Number.isFinite(alpha) && alpha >= 0 && alpha <= 1)
        canvasCall("alpha", canvasOwner(owner.canvas).id, { alpha });
    }
    get globalCompositeOperation(): string {
      return drawingState(this).globalCompositeOperation;
    }
    set globalCompositeOperation(value: unknown) {
      const owner = drawingOwner(this);
      const input = domString(value);
      const mode = input === "normal" ? "source-over" : input;
      if (
        [
          "clear",
          "source-over",
          "source-in",
          "source-out",
          "source-atop",
          "destination-over",
          "destination-in",
          "destination-out",
          "destination-atop",
          "lighter",
          "copy",
          "xor",
          "multiply",
          "screen",
          "overlay",
          "darken",
          "lighten",
          "color-dodge",
          "color-burn",
          "hard-light",
          "soft-light",
          "difference",
          "exclusion",
          "hue",
          "saturation",
          "color",
          "luminosity",
        ].includes(mode)
      )
        canvasCall("composite", canvasOwner(owner.canvas).id, { mode });
    }
    getContextAttributes(): Record<string, unknown> {
      return { ...drawingOwner(this).attributes };
    }
    isContextLost(): boolean {
      drawingOwner(this);
      return false;
    }
    fillRect(...args: unknown[]): void {
      rectangle(this, "fill", args);
    }
    clearRect(...args: unknown[]): void {
      rectangle(this, "clear", args);
    }
    save(): void {
      canvasCall("save", canvasOwner(drawingOwner(this).canvas).id);
    }
    restore(): void {
      canvasCall("restore", canvasOwner(drawingOwner(this).canvas).id);
    }
    reset(): void {
      canvasCall("reset", canvasOwner(drawingOwner(this).canvas).id);
    }
    getImageData(
      x: unknown,
      y: unknown,
      width: unknown,
      height: unknown,
      settings?: unknown,
    ): ImageData {
      const owner = drawingOwner(this);
      if (arguments.length < 4) throw new TypeError("getImageData requires four arguments");
      const rect = [x, y, width, height].map((value) =>
        canvasInteger(value, -2147483648, 2147483647),
      );
      const w = rect[2] ?? 0,
        h = rect[3] ?? 0;
      if (!w || !h) throw new DOMException("Invalid ImageData dimensions", "IndexSizeError");
      imageSettings(settings);
      return imageResult(
        canvasBytes("read", canvasOwner(owner.canvas).id, rect),
        Math.abs(w),
        Math.abs(h),
      );
    }
    putImageData(image: unknown, x: unknown, y: unknown, ...dirty: unknown[]): void {
      const owner = drawingOwner(this);
      if (arguments.length < 3 || (arguments.length > 3 && arguments.length < 7))
        throw new TypeError("putImageData requires three or seven arguments");
      if (typeof image !== "object" || image === null) throw new TypeError("Expected ImageData");
      const source = imageOwner(image);
      const position = [x, y].map((value) => canvasInteger(value, -2147483648, 2147483647));
      const region =
        dirty.length >= 4
          ? dirty.slice(0, 4).map((value) => canvasInteger(value, -2147483648, 2147483647))
          : [0, 0, source.width, source.height];
      const length = Number(typedLength(source.data));
      if (length !== source.width * source.height * 4)
        throw new DOMException("Invalid image storage", "InvalidStateError");
      const copy = new ByteArray(length);
      Reflect.apply(byteSet, copy, [source.data]);
      nativeCanvasPut(
        JSON.stringify({
          id: canvasOwner(owner.canvas).id,
          width: source.width,
          height: source.height,
          position,
          region,
        }),
        copy,
      );
    }
    createImageData(width: unknown, height?: unknown, settings?: unknown): ImageData {
      drawingOwner(this);
      if (arguments.length < 1) throw new TypeError("createImageData requires arguments");
      const existing =
        typeof width === "object" && width !== null ? imageOwners.get(width) : undefined;
      if (existing) return new ImageData(existing.width, existing.height);
      if (arguments.length < 2) throw new TypeError("createImageData requires dimensions");
      const w = canvasInteger(width, -2147483648, 2147483647),
        h = canvasInteger(height, -2147483648, 2147483647);
      return new ImageData(Math.abs(w), Math.abs(h), settings);
    }
  }
  class OffscreenCanvas extends EventTarget {
    constructor(width: unknown, height: unknown) {
      super();
      if (arguments.length < 2) throw new TypeError("OffscreenCanvas requires dimensions");
      const id = canvasCall<number>("create", 0, {
        width: canvasDimension(width),
        height: canvasDimension(height),
      });
      canvasOwners.set(this, { id, context: null });
    }
    get width(): number {
      return canvasCall<number[]>("size", canvasOwner(this).id)[0] ?? 0;
    }
    set width(value: unknown) {
      const id = canvasOwner(this).id;
      canvasCall("resize", id, { width: canvasDimension(value), height: this.height });
    }
    get height(): number {
      return canvasCall<number[]>("size", canvasOwner(this).id)[1] ?? 0;
    }
    set height(value: unknown) {
      const id = canvasOwner(this).id;
      canvasCall("resize", id, { width: this.width, height: canvasDimension(value) });
    }
    getContext(kind: unknown, options?: unknown): OffscreenCanvasRenderingContext2D | null {
      const owner = canvasOwner(this);
      if (arguments.length < 1) throw new TypeError("getContext requires a context type");
      const type = domString(kind);
      if (!["2d", "bitmaprenderer", "webgl", "webgl2", "webgpu"].includes(type))
        throw new TypeError("Invalid context type");
      if (type !== "2d") return null;
      if (owner.context) return owner.context;
      const input = typeof options === "object" && options !== null ? options : {};
      const colorSpace: unknown = Reflect.get(input, "colorSpace");
      imageSettings({ colorSpace });
      const colorType: unknown = Reflect.get(input, "colorType");
      if (colorType !== undefined) {
        const format = domString(colorType);
        if (!["unorm8", "float16"].includes(format)) throw new TypeError("invalid color type");
        if (format !== "unorm8") throw new Error("unsupported: canvas color type");
      }
      const alpha: unknown = Reflect.get(input, "alpha");
      const attributes = {
        alpha: alpha === undefined || Boolean(alpha),
        colorSpace: "srgb",
        colorType: "unorm8",
        desynchronized: Boolean(Reflect.get(input, "desynchronized")),
        willReadFrequently: Boolean(Reflect.get(input, "willReadFrequently")),
      };
      canvasCall("context", owner.id, { opaque: !attributes.alpha });
      const contextObject: unknown = Object.create(OffscreenCanvasRenderingContext2D.prototype);
      // Only this bitmap owner can construct a branded context from the private prototype.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const target = contextObject as OffscreenCanvasRenderingContext2D;
      drawingOwners.set(target, { canvas: this, attributes });
      const proxy = new Proxy(target, {
        set(object, key, value, receiver) {
          if (
            [
              "strokeStyle",
              "font",
              "filter",
              "shadowBlur",
              "shadowColor",
              "shadowOffsetX",
              "shadowOffsetY",
              "imageSmoothingEnabled",
              "imageSmoothingQuality",
              "lineWidth",
              "lineCap",
              "lineJoin",
              "miterLimit",
              "lineDashOffset",
              "textAlign",
              "textBaseline",
              "direction",
              "fontKerning",
              "fontStretch",
              "fontVariantCaps",
              "letterSpacing",
              "wordSpacing",
              "textRendering",
            ].includes(String(key))
          )
            throw new Error(`unsupported: canvas ${String(key)}`);
          return Reflect.set(object, key, value, receiver);
        },
      });
      drawingOwners.set(proxy, { canvas: this, attributes });
      owner.context = proxy;
      return proxy;
    }
    transferToImageBitmap(): never {
      canvasOwner(this);
      throw new Error("unsupported: ImageBitmap transfer");
    }
    convertToBlob(): Promise<never> {
      canvasOwner(this);
      return Promise.reject(new Error("unsupported: canvas image encoding"));
    }
  }
  Object.defineProperty(ImageData, "length", { value: 2, configurable: true });
  function canvasArity(prototype: object, name: string, length: number): void {
    const method: unknown = Reflect.get(prototype, name);
    if (typeof method !== "function") throw new Error("missing canvas method");
    Object.defineProperty(method, "length", { value: length, configurable: true });
  }
  for (const [name, length] of [
    ["putImageData", 3],
    ["fillRect", 4],
    ["clearRect", 4],
    ["getImageData", 4],
    ["createImageData", 1],
  ] as const)
    canvasArity(OffscreenCanvasRenderingContext2D.prototype, name, length);
  canvasArity(OffscreenCanvas.prototype, "getContext", 1);
  for (const [prototype, name] of [
    [OffscreenCanvas.prototype, "OffscreenCanvas"],
    [OffscreenCanvasRenderingContext2D.prototype, "OffscreenCanvasRenderingContext2D"],
    [ImageData.prototype, "ImageData"],
  ] as const)
    Object.defineProperty(prototype, Symbol.toStringTag, { value: name, configurable: true });
  for (const name of [
    "drawImage",
    "measureText",
    "fillText",
    "strokeText",
    "strokeRect",
    "beginPath",
    "closePath",
    "moveTo",
    "lineTo",
    "arc",
    "arcTo",
    "ellipse",
    "rect",
    "roundRect",
    "bezierCurveTo",
    "quadraticCurveTo",
    "fill",
    "stroke",
    "clip",
    "translate",
    "rotate",
    "scale",
    "transform",
    "setTransform",
    "resetTransform",
    "getTransform",
    "createPattern",
    "createLinearGradient",
    "createRadialGradient",
    "createConicGradient",
    "isPointInPath",
    "isPointInStroke",
    "setLineDash",
    "getLineDash",
  ])
    Object.defineProperty(OffscreenCanvasRenderingContext2D.prototype, name, {
      value: function (this: object) {
        drawingOwner(this);
        throw new Error(`unsupported: canvas ${name}`);
      },
      writable: true,
      configurable: true,
    });

  class FontFace {
    constructor(family: unknown, source: unknown, descriptors?: unknown) {
      if (arguments.length < 2) throw new TypeError("FontFace requires family and source");
      const name = domString(family);
      const options = encodingOptions(descriptors);
      let resolve: (value: FontFace) => void = fontNoop;
      let reject: (reason: unknown) => void = fontNoop;
      const promise = new FontPromise<FontFace>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const state: FontState = {
        family: name,
        status: "unloaded",
        promise,
        resolve,
        reject,
        data: null,
        resources: null,
        descriptors: {},
        base: documentBase(),
      };
      fontFaces.set(this, state);
      void Reflect.apply(fontCatch, promise, [() => {}]);
      try {
        for (const [key, defaultValue] of Object.entries(fontDefaults)) {
          const value = Reflect.get(options, key);
          state.descriptors[key] = fontDescriptor(key, value === undefined ? defaultValue : value);
        }
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "SyntaxError") throw error;
        failFont(state, error);
        return;
      }
      if (typeof source === "string") {
        // Parsed shape belongs exclusively to the native source grammar.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        state.resources = JSON.parse(nativeFontMeta("source", source)) as FontResource[] | null;
        if (state.resources === null)
          failFont(state, new DOMException("Invalid font source", "SyntaxError"));
      } else {
        const data = fontBytes(source);
        if (nativeFontData(data)) {
          state.data = data;
          state.status = "loaded";
          state.resolve(this);
        } else failFont(state, new DOMException("Invalid font data", "SyntaxError"));
      }
    }
    get family(): string {
      return fontState(this).family;
    }
    set family(value: unknown) {
      fontState(this).family = domString(value);
    }
    get status(): string {
      return fontState(this).status;
    }
    get loaded(): Promise<FontFace> {
      return fontState(this).promise;
    }
    load(): Promise<FontFace> {
      try {
        return beginFont(this);
      } catch (error) {
        return fontReject<FontFace>(error);
      }
    }
  }
  function beginFont(owner: FontFace): Promise<FontFace> {
    const state = fontState(owner);
    if (state.status === "unloaded") {
      state.status = "loading";
      fontSetLoading(owner);
      void loadFont(owner, state);
    }
    return state.promise;
  }

  for (const [key, defaultValue] of Object.entries(fontDefaults)) {
    Object.defineProperty(FontFace.prototype, key, {
      get(this: FontFace): string {
        return fontState(this).descriptors[key] ?? defaultValue;
      },
      set(this: FontFace, value: unknown) {
        const state = fontState(this);
        state.descriptors[key] = fontDescriptor(key, value);
      },
      enumerable: true,
      configurable: true,
    });
  }
  Object.defineProperty(FontFace.prototype, Symbol.toStringTag, {
    value: "FontFace",
    configurable: true,
  });
  type FontDefinition = {
    owner: string;
    ordinal: number;
    family: string;
    source: string;
    base: string;
    descriptors: Record<string, string>;
  };
  type FontSetState = {
    status: "loaded" | "loading";
    pending: Set<FontFace>;
    completed: FontFace[];
    failed: FontFace[];
    finishing: boolean;
    css: Map<string, FontFace>;
    manual: Set<FontFace>;
    all: Set<FontFace>;
    version: number;
  };
  const fontSets = new WeakMap<object, FontSetState>();
  const fontSetKey = {};
  const fontEventFaces = new WeakMap<object, readonly FontFace[]>();
  class FontFaceSetLoadEvent extends Event {
    constructor(type: unknown, init?: unknown) {
      if (arguments.length === 0) throw new TypeError("FontFaceSetLoadEvent requires a type");
      const options = encodingOptions(init);
      super(type, {
        bubbles: options.bubbles,
        cancelable: options.cancelable,
        composed: options.composed,
      });
      const input: unknown = Reflect.get(options, "fontfaces");
      const faces: FontFace[] = [];
      if (input !== undefined) {
        if (typeof input !== "object" || input === null || !(Symbol.iterator in input))
          throw new TypeError("fontfaces must be a sequence");
        // Web IDL sequences use the supplied object's iterator.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        for (const face of input as Iterable<FontFace>) {
          fontState(face);
          faces.push(face);
        }
      }
      fontEventFaces.set(this, Object.freeze(faces));
    }
    get fontfaces(): readonly FontFace[] {
      const faces = fontEventFaces.get(this);
      if (!faces) throw new TypeError("Illegal FontFaceSetLoadEvent invocation");
      return faces;
    }
  }
  Object.defineProperty(FontFaceSetLoadEvent.prototype, Symbol.toStringTag, {
    value: "FontFaceSetLoadEvent",
    configurable: true,
  });
  function fontSetLoading(face: FontFace): void {
    const state = fontSets.get(documentFonts);
    if (!state || !state.all.has(face) || state.pending.has(face)) return;
    state.pending.add(face);
    if (state.status === "loaded") {
      state.status = "loading";
      setTimeout(() => {
        dispatch(documentFonts, new FontFaceSetLoadEvent("loading"), true);
      }, 0);
    }
  }
  function finishFontSet(state: FontSetState): void {
    if (state.finishing || state.pending.size !== 0 || state.status !== "loading") return;
    state.finishing = true;
    setTimeout(() => {
      state.finishing = false;
      if (state.pending.size !== 0) return;
      state.status = "loaded";
      const completed = state.completed.splice(0);
      const failed = state.failed.splice(0);
      dispatch(
        documentFonts,
        new FontFaceSetLoadEvent("loadingdone", { fontfaces: completed }),
        true,
      );
      if (failed.length !== 0)
        dispatch(
          documentFonts,
          new FontFaceSetLoadEvent("loadingerror", { fontfaces: failed }),
          true,
        );
    }, 0);
  }
  function fontSetSettled(font: FontState, success: boolean): void {
    const state = fontSets.get(documentFonts);
    if (!state) return;
    for (const face of state.pending) {
      if (fontState(face) !== font) continue;
      state.pending.delete(face);
      (success ? state.completed : state.failed).push(face);
      finishFontSet(state);
      return;
    }
  }

  function fontSetState(owner: object): FontSetState {
    const state = fontSets.get(owner);
    if (!state) throw new TypeError("Illegal FontFaceSet invocation");
    const version = raw<number>("layoutVersion", 0);
    if (state.version !== version) {
      const fontDefinitions = raw<FontDefinition[]>("fontFaces", 0);
      const next = new Map<string, FontFace>();
      for (const definition of fontDefinitions) {
        const key = JSON.stringify(definition);
        let face = state.css.get(key);
        if (!face) {
          face = new FontFace(definition.family, definition.source, definition.descriptors);
          fontState(face).base = definition.base;
        }
        next.set(key, face);
      }
      state.css = next;
      state.all.clear();
      for (const face of next.values()) state.all.add(face);
      for (const face of state.manual) state.all.add(face);
      state.version = version;
    }
    return state;
  }
  class FontFaceSet extends EventTarget {
    constructor(key: unknown) {
      super();
      if (key !== fontSetKey) throw new Error("unsupported: FontFaceSet construction");
      fontSets.set(this, {
        css: new Map(),
        manual: new Set(),
        all: new Set(),
        version: -1,
        status: "loaded",
        pending: new Set(),
        completed: [],
        failed: [],
        finishing: false,
      });
    }
    get size(): number {
      return fontSetState(this).all.size;
    }
    get status(): string {
      return fontSetState(this).status;
    }
    get ready(): never {
      fontSetState(this);
      throw new Error("unsupported: font layout readiness");
    }
    add(face: FontFace): this {
      const state = fontSetState(this);
      fontState(face);
      if (![...state.css.values()].includes(face)) state.manual.add(face);
      state.all.add(face);
      if (fontState(face).status === "loading") fontSetLoading(face);
      return this;
    }
    delete(face: FontFace): boolean {
      const state = fontSetState(this);
      fontState(face);
      if ([...state.css.values()].includes(face)) return false;
      state.all.delete(face);
      state.pending.delete(face);
      finishFontSet(state);
      return state.manual.delete(face);
    }
    clear(): void {
      const state = fontSetState(this);
      for (const face of state.manual) {
        state.all.delete(face);
        state.pending.delete(face);
      }
      finishFontSet(state);
      state.manual.clear();
    }
    has(face: FontFace): boolean {
      fontState(face);
      return fontSetState(this).all.has(face);
    }
    values(): SetIterator<FontFace> {
      return fontSetState(this).all.values();
    }
    keys(): SetIterator<FontFace> {
      return this.values();
    }
    entries(): SetIterator<[FontFace, FontFace]> {
      return fontSetState(this).all.entries();
    }
    [Symbol.iterator](): SetIterator<FontFace> {
      return this.values();
    }
    forEach(
      callback: (value: FontFace, key: FontFace, set: FontFaceSet) => unknown,
      thisArg?: unknown,
    ): void {
      if (typeof callback !== "function") throw new TypeError("callback must be callable");
      for (const face of fontSetState(this).all)
        Reflect.apply(callback, thisArg, [face, face, this]);
    }
    load(font: unknown, text: unknown = " "): Promise<FontFace[]> {
      try {
        fontSetState(this);
        if (arguments.length === 0) throw new TypeError("FontFaceSet.load requires a font");
        const faces = matchingFonts(this, font, text);
        return fontAll(faces.map(beginFont));
      } catch (error) {
        return fontReject<FontFace[]>(error);
      }
    }
    check(font: unknown, text: unknown = " "): boolean {
      fontSetState(this);
      if (arguments.length === 0) throw new TypeError("FontFaceSet.check requires a font");
      return matchingFonts(this, font, text).every((face) => fontState(face).status === "loaded");
    }
  }
  function matchingFonts(owner: FontFaceSet, font: unknown, text: unknown): FontFace[] {
    const source = usvString(font);
    // UTF-16 code units preserve the DOMString sample, including isolated surrogates.
    const sample: unknown = JSON.parse(encodingUnits(text));
    const faces = [...fontSetState(owner).all];
    const descriptions = faces.map((face) => {
      const state = fontState(face);
      return {
        family: usvString(state.family),
        style: state.descriptors.style ?? "normal",
        weight: state.descriptors.weight ?? "normal",
        stretch: state.descriptors.stretch ?? "normal",
        range: state.descriptors.unicodeRange ?? "U+0-10FFFF",
      };
    });
    // Indices and null syntax failures are produced by the native CSS matcher.
    const result: unknown = JSON.parse(
      nativeFontMatch(JSON.stringify({ font: source, text: sample, faces: descriptions })),
    );
    if (
      result !== null &&
      (!Array.isArray(result) || !result.every((index: unknown) => typeof index === "number"))
    )
      throw new Error("Invalid native font match");
    const indices: number[] | null = result;
    if (indices === null) throw new DOMException("Invalid font shorthand", "SyntaxError");
    return indices.map((index) => {
      const face = faces[index];
      if (!face) throw new Error("Invalid native font match");
      return face;
    });
  }

  Object.defineProperty(FontFaceSet.prototype, Symbol.toStringTag, {
    value: "FontFaceSet",
    configurable: true,
  });
  const documentFonts = new FontFaceSet(fontSetKey);
  Object.defineProperty(Document.prototype, "fonts", {
    get(this: Document): FontFaceSet {
      if (this !== document) throw new Error("unsupported: independent document font sets");
      fontSetState(documentFonts);
      return documentFonts;
    },
    enumerable: true,
    configurable: true,
  });
  Object.assign(globalThis, {
    document,
    Storage,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    MediaQueryList,
    MediaQueryListEvent,
    matchMedia,
    window: globalThis,
    self: globalThis,
    location: Object.freeze({
      href,
      origin: linkValue("get", "origin", href, ""),
      protocol: linkValue("get", "protocol", href, ""),
      host: linkValue("get", "host", href, ""),
      hostname: linkValue("get", "hostname", href, ""),
      port: linkValue("get", "port", href, ""),
      pathname: linkValue("get", "pathname", href, ""),
      search: linkValue("get", "search", href, ""),
      hash: linkValue("get", "hash", href, ""),
      toString: () => href,
    }),
    Event,
    CustomEvent,
    ErrorEvent,
    EventTarget,
    AbortSignal,
    AbortController,
    Node,
    Element,
    HTMLElement,
    HTMLAnchorElement,
    HTMLStyleElement,
    HTMLLinkElement,
    HTMLIFrameElement,
    SVGElement,
    DOMStringMap,
    CSSStyleDeclaration,
    CSSStyleProperties,
    StyleSheet,
    CSSStyleSheet,
    CSSRule,
    CSSStyleRule,
    CSSRuleList,
    StyleSheetList,
    getComputedStyle,
    CustomElementRegistry,
    Document,
    DocumentFragment,
    DocumentType,
    NodeList,
    HTMLCollection,
    DOMTokenList,
    DOMRect,
    DOMRectReadOnly,
    IntersectionObserver,
    IntersectionObserverEntry,
    CharacterData,
    Text,
    Comment,
    fetch,
    Response,
    OffscreenCanvas,
    OffscreenCanvasRenderingContext2D,
    ImageData,
    FontFace,
    FontFaceSet,
    FontFaceSetLoadEvent,
    setTimeout,
    requestAnimationFrame,
    cancelAnimationFrame,
    setInterval,
    clearTimeout,
    clearInterval: clearTimeout,
    queueMicrotask,
    addEventListener: EventTarget.prototype.addEventListener.bind(globalThis),
    removeEventListener: EventTarget.prototype.removeEventListener.bind(globalThis),
    dispatchEvent: EventTarget.prototype.dispatchEvent.bind(globalThis),
  });

  Object.defineProperties(globalThis, {
    URL: { value: URL, writable: true, enumerable: false, configurable: true },
    URLSearchParams: {
      value: URLSearchParams,
      writable: true,
      enumerable: false,
      configurable: true,
    },
    webkitURL: { value: URL, writable: true, enumerable: false, configurable: true },
    customElements: { get: () => customElements, enumerable: true, configurable: true },
    innerWidth: { get: () => mediaEnvironment.width, enumerable: true, configurable: true },
    innerHeight: { get: () => mediaEnvironment.height, enumerable: true, configurable: true },
    localStorage: { get: () => localStorage, enumerable: true, configurable: true },
    sessionStorage: { get: () => sessionStorage, enumerable: true, configurable: true },
  });

  const ready = (complete = true) => {
    readyState = "interactive";
    if (!complete) return;
    dispatch(document, new Event("DOMContentLoaded", { bubbles: true }), true);
    readyState = "complete";
    dispatch(globalThis, new Event("load"), true, true);
  };
  const resource = (handle: number, success: boolean) => {
    if (timerTasks >= timerTaskLimit) throw new Error("timer task limit");
    timerTasks++;
    dispatch(node(handle), new Event(success ? "load" : "error"), true);
  };
  const CSS = {};
  Object.defineProperty(CSS, "supports", {
    enumerable: true,
    writable: true,
    configurable: true,
    value: function supports(property: unknown, ...values: unknown[]): boolean {
      if (arguments.length === 0) throw new TypeError("supports requires an argument");
      const name = domString(property);
      return arguments.length === 1
        ? raw<boolean>("cssSupports", 0, name)
        : raw<boolean>("cssSupportsValue", 0, name, domString(values[0]));
    },
  });
  Object.defineProperty(CSS, Symbol.toStringTag, { value: "CSS", configurable: true });
  Object.defineProperty(globalThis, "CSS", { value: CSS, writable: true, configurable: true });
  const namedWindowCollections = new Map<string, HTMLCollection>();
  function namedWindowValue(key: string | symbol): Node | HTMLCollection | undefined {
    if (typeof key !== "string") return undefined;
    const matches = call<number[]>("windowNamed", 0, key);
    if (matches.length === 0) return undefined;
    const first = matches[0];
    if (matches.length === 1 && first !== undefined) return node(first);
    let collection = namedWindowCollections.get(key);
    if (!collection) {
      collection = makeCollection(
        new HTMLCollection(internal),
        () => call<number[]>("windowNamed", 0, key),
        true,
      );
      namedWindowCollections.set(key, collection);
    }
    return collection;
  }
  // The global prototype resolves live DOM names without rewriting page scripts.
  class Window extends EventTarget {
    constructor() {
      super();
      throw new TypeError("Illegal constructor");
    }
  }
  Object.defineProperty(globalThis, "Window", {
    value: Window,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(Window.prototype, Symbol.toStringTag, {
    value: "Window",
    configurable: true,
  });
  const namedWindowTarget: unknown = Object.create(EventTarget.prototype);
  if (namedWindowTarget === null || typeof namedWindowTarget !== "object")
    throw new TypeError("invalid named window target");
  const namedWindowProperties = new Proxy(namedWindowTarget, {
    get(target, key, receiver): unknown {
      return Reflect.has(target, key) ? Reflect.get(target, key, receiver) : namedWindowValue(key);
    },
    has(target, key): boolean {
      return Reflect.has(target, key) || namedWindowValue(key) !== undefined;
    },
    defineProperty: () => false,
    deleteProperty: () => false,
    preventExtensions: () => false,
    setPrototypeOf: (target, prototype) => Reflect.getPrototypeOf(target) === prototype,
    getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
      const existing = Reflect.getOwnPropertyDescriptor(target, key);
      if (Reflect.has(target, key)) return existing;
      const value = namedWindowValue(key);
      return value === undefined
        ? undefined
        : { value, writable: true, enumerable: false, configurable: true };
    },
  });
  Object.setPrototypeOf(Window.prototype, namedWindowProperties);
  Reflect.deleteProperty(globalThis, Symbol.toStringTag);
  Object.setPrototypeOf(globalThis, Window.prototype);
  return { ready, timer, intersections, resource };
})();
