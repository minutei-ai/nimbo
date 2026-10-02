(() => {
  "use strict";
  const nativeDom = nimboDom;
  const nativeRequest = nimboRequest;
  const nativeStorage = nimboStorage;
  const nativeMedia = nimboMedia;
  const nativeEncode = nimboEncode;
  const nativeDecoder = nimboDecoder;
  const nativeLink = nimboLink;
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
  Reflect.deleteProperty(globalThis, "nimboMedia");
  Reflect.deleteProperty(globalThis, "nimboEncode");
  Reflect.deleteProperty(globalThis, "nimboDecoder");
  Reflect.deleteProperty(globalThis, "nimboLink");
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
  type CollectionState = { resolve: () => Node[] };
  const collections = new WeakMap<Collection, CollectionState>();
  const childLists = new WeakMap<Node, NodeList>();
  const elementLists = new WeakMap<ParentNode, HTMLCollection>();
  function collectionState(list: Collection): CollectionState {
    const state = collections.get(list);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  function namedNodes(items: Node[]): Map<string, Element> {
    const names = new Map<string, Element>();
    for (const item of items) {
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
    resolve: () => Node[],
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
        if (index !== null) return resolve()[index];
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
        const keys: (string | symbol)[] = items.map((_, index) => String(index));
        if (named) {
          for (const key of namedNodes(items).keys()) if (!Reflect.has(object, key)) keys.push(key);
        }
        return Array.from(new Set([...keys, ...Reflect.ownKeys(object)]));
      },
      getOwnPropertyDescriptor(object, key) {
        const index = propertyIndex(key);
        if (index !== null) {
          const value = resolve()[index];
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
      return collectionState(this).resolve()[index >>> 0] ?? null;
    }
    forEach(
      callback: (this: unknown, value: Node, index: number, list: NodeList) => void,
      thisArg?: unknown,
    ) {
      const state = collectionState(this);
      if (typeof callback !== "function") throw new TypeError("callback must be a function");
      const length = state.resolve().length;
      for (let index = 0; index < length; index++) {
        const value = state.resolve()[index];
        if (value !== undefined) callback.call(thisArg, value, index, this);
      }
    }
    entries(): Generator<[number, Node]> {
      return collectionEntries(collectionState(this));
    }
    keys(): Generator<number> {
      const state = collectionState(this);
      return (function* () {
        for (const [index] of collectionEntries(state)) yield index;
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
      const value = state.resolve()[index];
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
      const value = collectionState(this).resolve()[index >>> 0];
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
      const snapshot = call<number[]>("query", idOf(this), selector).map(element);
      return makeCollection(new NodeList(internal), () => snapshot);
    }
    querySelector(selector: string): Element | null {
      const id = call<number | null>("queryOne", idOf(this), selector);
      return id === null ? null : element(id);
    }
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
    getBoundingClientRect(): DOMRect {
      const result = call<RectValues>("bounds", idOf(this));
      return new DOMRect(result.x, result.y, result.width, result.height);
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
    get namespaceURI(): string {
      return call("get", idOf(this), "namespaceURI");
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
  const inlineStyles = new WeakMap<object, CSSStyleProperties>();
  function styleOperation(
    owner: object,
    operation = "get",
    name = "",
    value = "",
    priority = "",
  ): StyleOutput {
    const id = styleOwners.get(owner);
    if (id === undefined) throw new TypeError("Illegal invocation");
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
    get parentRule(): null {
      styleOperation(this);
      return null;
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
    return key.includes("-") ? key : key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
  }
  function inlineStyle(owner: object): CSSStyleProperties {
    const id = htmlId(owner);
    const cached = inlineStyles.get(owner);
    if (cached) return cached;
    // Inline declarations are manufactured only by the branded element getter.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const target = Object.create(CSSStyleProperties.prototype) as CSSStyleProperties;
    styleOwners.set(target, id);
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
    inlineStyles.set(owner, proxy);
    return proxy;
  }
  class HTMLElement extends Element {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) return constructHTML(new.target);
      super(internal, id);
      htmlElements.add(this);
      return this;
    }
    get style(): CSSStyleProperties {
      return inlineStyle(this);
    }
    set style(value: unknown) {
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
  function customMutation<T>(operation: string, id: number, arg: string, value: string): T {
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
    return reactions(() => {
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
    });
  }
  class CharacterData extends Node {
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
      case 1:
        return call<string>("get", id, "namespaceURI") === "http://www.w3.org/1999/xhtml"
          ? call<string>("get", id, "localName") === "a"
            ? new HTMLAnchorElement(internal, id)
            : new HTMLElement(internal, id)
          : new Element(internal, id);
      case 3:
        return new Text("", internal, id);
      case 8:
        return new Comment("", internal, id);
      case 11:
        return new DocumentFragment(internal, id);
      default:
        return new Node(internal, id);
    }
  }

  class DocumentFragment extends ParentNode {
    constructor(key?: symbol, id?: number) {
      super(internal, key === internal && id !== undefined ? id : call("createFragment", 0));
    }
  }
  function element(id: number): Element {
    const result = node(id);
    if (!(result instanceof Element)) throw new TypeError("expected Element");
    return result;
  }

  let readyState = "loading";
  class Document extends ParentNode {
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
    createElement(tag: string) {
      if (arguments.length === 0) throw new TypeError("createElement requires a name");
      const localName = domString(tag);
      const target = element(call("create", 0, localName));
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
            const fallback = new HTMLElement(internal, call<number>("create", 0, localName));
            customStates.set(fallback, { definition, status: "failed" });
            return fallback;
          }
        }
      }
      return target;
    }
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
    if (timers.size >= timerLimit) throw new Error("timer capacity limit");
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
    let selected: [number, Timer] | undefined;
    for (const entry of timers) {
      if (!selected || entry[1].due < selected[1].due) selected = entry;
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

  const fetch = async (url: string, options: { method?: string; body?: string } = {}) => {
    for (const key of Object.keys(options)) {
      if (!["method", "body"].includes(key)) throw new Error(`unsupported fetch option: ${key}`);
    }
    const method = (options.method ?? "GET").toUpperCase();
    if (method === "GET" && options.body !== undefined) throw new Error("GET cannot have a body");
    // Rust owns the serialized HTTP response shape.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const response = JSON.parse(await nativeRequest(url, method, options.body ?? "")) as {
      status: number;
      body: string;
      url: string;
    };
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      url: response.url,
      text: async () => response.body,
      json: async (): Promise<unknown> => JSON.parse(response.body),
    };
  };
  Object.assign(globalThis, {
    document,
    Storage,
    TextEncoder,
    TextDecoder,
    MediaQueryList,
    MediaQueryListEvent,
    matchMedia,
    window: globalThis,
    self: globalThis,
    location: Object.freeze({ href, toString: () => href }),
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
    CSSStyleDeclaration,
    CSSStyleProperties,
    CustomElementRegistry,
    Document,
    DocumentFragment,
    NodeList,
    HTMLCollection,
    DOMTokenList,
    DOMRect,
    DOMRectReadOnly,
    CharacterData,
    Text,
    Comment,
    fetch,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval: clearTimeout,
    queueMicrotask,
    addEventListener: EventTarget.prototype.addEventListener.bind(globalThis),
    removeEventListener: EventTarget.prototype.removeEventListener.bind(globalThis),
    dispatchEvent: EventTarget.prototype.dispatchEvent.bind(globalThis),
  });

  Object.defineProperties(globalThis, {
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
  return { ready, timer };
})();
