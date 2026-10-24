(() => {
  "use strict";
  const fatalErrors = new WeakSet<object>();
  const addFatal = fatalErrors.add.bind(fatalErrors);
  const hasFatal = fatalErrors.has.bind(fatalErrors);
  const LimitError = Error;
  function markFatal(error: object) {
    addFatal(error);
  }
  function failLimit(message: string): never {
    const error = new LimitError(message);
    markFatal(error);
    throw error;
  }
  const nativeDom = nimboDom;
  const nativeRequest = nimboRequest;
  const nativeStorage = nimboStorage;
  const nativeCookie = nimboCookie;
  const nativeMedia = nimboMedia;
  const devicePixelRatio = nimboDevicePixelRatio;
  const nativeEncode = nimboEncode;
  const nativeDecoder = nimboDecoder;
  const nativeLink = nimboLink;
  const nativeCanvas = nimboCanvas;
  const nativeCanvasPut = nimboCanvasPut;
  const nativeFontData = nimboFontData;
  const nativeFontMeasure = nimboFontMeasure;
  const nativeFontMeta = nimboFontMeta;
  const nativeFontMatch = nimboFontMatch;
  // Values are validated by Rust before installing the page bindings.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const mediaEnvironment = JSON.parse(nimboMediaEnvironment) as { width: number; height: number };
  let href = nimboUrl;
  const userAgent = nimboUserAgent;
  const nativeIsProxy = nimboIsProxy;
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
  Reflect.deleteProperty(globalThis, "nimboFontMeasure");
  Reflect.deleteProperty(globalThis, "nimboFontMeta");
  Reflect.deleteProperty(globalThis, "nimboFontMatch");
  Reflect.deleteProperty(globalThis, "nimboMediaEnvironment");
  Reflect.deleteProperty(globalThis, "nimboDevicePixelRatio");
  Reflect.deleteProperty(globalThis, "nimboUrl");
  Reflect.deleteProperty(globalThis, "nimboUserAgent");
  Reflect.deleteProperty(globalThis, "nimboIsProxy");
  Reflect.deleteProperty(globalThis, "nimboNow");
  Reflect.deleteProperty(globalThis, "nimboTimerLimit");
  Reflect.deleteProperty(globalThis, "nimboTimerTaskLimit");

  let fontsEverLoaded = false;
  const ids = new WeakMap<object, number>();
  const nodes = new Map<number, Node>();
  // Result shapes are serialized by Rust for each native operation.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  const raw = <T>(operation: string, id: number, arg = "", value = ""): T => {
    // The bridge owns this JSON contract; it is not page-supplied JSON.
    if (
      fontsEverLoaded &&
      ["bounds", "geometry", "observerMeasure", "computedStyle"].includes(operation)
    )
      synchronizeLayoutFonts();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const result = JSON.parse(nativeDom(operation, id, arg, value)) as T;
    if (
      (shadowRoots.size > 0 || mutationObservers.size > 0) &&
      ([
        "attachShadow",
        "set",
        "setAttr",
        "removeAttr",
        "setAttrNS",
        "removeAttrNS",
        "append",
        "insert",
        "replace",
        "remove",
        "removeChild",
        "attributeNode",
        "style",
      ].includes(operation) ||
        (operation === "selection" && arg === "setLength"))
    )
      queueDomNotifications();
    return result;
  };
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  const call = <T>(operation: string, id: number, arg = "", value = ""): T =>
    customMutation<T>(operation, id, arg, value);

  type Target = EventTarget | typeof globalThis;
  type Listener = ((this: Target, event: Event) => void) | { handleEvent(event: Event): void };
  type EventInit = { bubbles?: unknown; cancelable?: unknown; composed?: unknown };
  type EventPathItem = { target: Target; adjusted: Target; closedRoots: number[] };
  const shadowRoots = new Set<number>();
  const signalSlots = new Set<Node>();
  let domMicrotask = false;
  function queueDomNotifications(): void {
    if (shadowRoots.size > 0)
      for (const id of raw<number[]>("slotChanges", 0)) signalSlots.add(node(id));
    const pending = mutationObservers.size > 0 ? raw<number[]>("mutation", 0, "pending") : [];
    if (domMicrotask || (signalSlots.size === 0 && pending.length === 0)) return;
    domMicrotask = true;
    queueMicrotask(() => {
      domMicrotask = false;
      const observers = mutationObservers.size > 0 ? raw<number[]>("mutation", 0, "pending") : [];
      const slots = [...signalSlots];
      signalSlots.clear();
      for (const id of observers) {
        const observer = mutationObservers.get(id);
        if (!observer) continue;
        const records = mutationRecords(id, "notify");
        if (records.length === 0) continue;
        try {
          mutationState(observer).callback.call(observer, records, observer);
        } catch (error) {
          reportListenerError(error);
        }
      }
      for (const slot of slots) dispatch(slot, new Event("slotchange", { bubbles: true }), true);
    });
  }
  type EventState = {
    type: string;
    bubbles: boolean;
    cancelable: boolean;
    composed: boolean;
    target: Target | null;
    current: Target | null;
    phase: number;
    path: EventPathItem[];
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
  const events = new WeakMap<object, EventState>();
  const listeners = new WeakMap<object, Map<string, ListenerRecord[]>>();
  const targets = new WeakSet<object>();
  const aborts = new WeakMap<
    object,
    { aborted: boolean; reason: unknown; algorithms: Set<() => void> }
  >();
  const controllers = new WeakMap<AbortController, AbortSignal>();
  const details = new WeakMap<CustomEvent, unknown>();
  const errorDetails = new WeakMap<
    ErrorEvent,
    { error: unknown; message: string; filename: string }
  >();
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
    if (string.length > 65_536) failLimit("encoding input limit");
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
    if (typeof length !== "number" || length > 65_536) failLimit("encoding input limit");
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
  function eventState(event: object): EventState {
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
      const state = eventState(this);
      const current = state.path.find((item) => item.target === state.current);
      return state.path
        .filter((item) => item.closedRoots.every((root) => current?.closedRoots.includes(root)))
        .map((item) => item.target);
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
  type UIState = {
    level: number;
    values: Record<string, unknown>;
    coalesced?: PointerEvent[];
    predicted?: PointerEvent[];
  };
  const uiEvents = new WeakMap<object, UIState>();
  function uiState(owner: object, level: number): UIState {
    const state = uiEvents.get(owner);
    if (!state || state.level < level) throw new TypeError("Illegal invocation");
    return state;
  }
  const mouseFields = [
    "altKey",
    "button",
    "buttons",
    "clientX",
    "clientY",
    "ctrlKey",
    "metaKey",
    "relatedTarget",
    "screenX",
    "screenY",
    "shiftKey",
  ] as const;
  const pointerFields = [
    "altitudeAngle",
    "azimuthAngle",
    "height",
    "isPrimary",
    "persistentDeviceId",
    "pointerId",
    "pointerType",
    "pressure",
    "tangentialPressure",
    "tiltX",
    "tiltY",
    "twist",
    "width",
  ] as const;
  const modifierNames = [
    "AltGraph",
    "CapsLock",
    "Fn",
    "FnLock",
    "Hyper",
    "NumLock",
    "ScrollLock",
    "Super",
    "Symbol",
    "SymbolLock",
  ] as const;
  const uiInitFields = ["bubbles", "cancelable", "composed", "detail", "view"];
  const mouseInitFields = [
    ...uiInitFields,
    ...mouseFields,
    ...modifierNames.map((name) => `modifier${name}`),
  ].toSorted();
  const pointerInitFields = [
    ...mouseInitFields,
    ...pointerFields,
    "coalescedEvents",
    "predictedEvents",
  ].toSorted();
  function uiConvert(name: string, value: unknown): unknown {
    if (
      [
        "bubbles",
        "cancelable",
        "composed",
        "altKey",
        "ctrlKey",
        "metaKey",
        "shiftKey",
        "isPrimary",
      ].includes(name) ||
      name.startsWith("modifier")
    )
      return Boolean(value);
    if (name === "view") {
      if (value !== null && value !== globalThis) throw new TypeError("Expected Window");
      return value;
    }
    if (name === "relatedTarget") {
      if (value !== null && (typeof value !== "object" || !targets.has(value)))
        throw new TypeError("Expected EventTarget");
      return value;
    }
    if (name === "pointerType") return domString(value);
    if (name === "button") return (idlNumber(value) << 16) >> 16;
    if (name === "buttons") return (idlNumber(value) >>> 0) & 65535;
    if (["detail", "pointerId", "persistentDeviceId", "tiltX", "tiltY", "twist"].includes(name))
      return idlNumber(value) | 0;
    const number = finiteDouble(value);
    if (name === "pressure" || name === "tangentialPressure") {
      const single = Math.fround(number);
      if (!Number.isFinite(single)) throw new TypeError("Expected finite float");
      return single;
    }
    return number;
  }
  function ownedPointerEvent(value: unknown): value is PointerEvent {
    return value !== null && typeof value === "object" && uiEvents.get(value)?.level === 3;
  }
  function pointerSequence(value: unknown): PointerEvent[] {
    const source = dictionary(value);
    if (!source) throw new TypeError("Expected pointer sequence");
    const method: unknown = Reflect.get(source, Symbol.iterator);
    if (typeof method !== "function") throw new TypeError("Expected pointer sequence");
    const iteratorResult: unknown = Reflect.apply(method, source, []);
    const iterator = dictionary(iteratorResult);
    if (!iterator) throw new TypeError("Expected iterator object");
    const next: unknown = Reflect.get(iterator, "next");
    if (typeof next !== "function") throw new TypeError("Expected iterator next");
    const pointerItems: PointerEvent[] = [];
    for (;;) {
      const stepResult: unknown = Reflect.apply(next, iterator, []);
      const step = dictionary(stepResult);
      if (!step) throw new TypeError("Expected iterator result");
      if (Reflect.get(step, "done")) return pointerItems;
      const event: unknown = Reflect.get(step, "value");
      if (!ownedPointerEvent(event)) throw new TypeError("Expected PointerEvent");
      pointerItems.push(event);
    }
  }
  function pointerAngles(
    values: Record<string, unknown>,
    altitude: boolean,
    azimuth: boolean,
    tilt: boolean,
  ): void {
    if (!altitude && !azimuth && tilt) {
      const x = Math.tan((Number(values.tiltX) * Math.PI) / 180),
        y = Math.tan((Number(values.tiltY) * Math.PI) / 180);
      values.altitudeAngle = Math.atan(1 / Math.hypot(x, y));
      const angle = Math.atan2(y, x);
      values.azimuthAngle = angle < 0 ? angle + 2 * Math.PI : angle;
    } else if (!tilt && (altitude || azimuth)) {
      const tangent = Math.tan(Number(values.altitudeAngle)),
        angle = Number(values.azimuthAngle);
      const x = Math.cos(angle),
        y = Math.sin(angle);
      values.tiltX = Math.round((Math.atan(Math.abs(x) < 1e-15 ? 0 : x / tangent) * 180) / Math.PI);
      values.tiltY = Math.round((Math.atan(Math.abs(y) < 1e-15 ? 0 : y / tangent) * 180) / Math.PI);
    }
  }
  function uiInitialization(init: unknown, level: number): UIState {
    if (
      init !== null &&
      init !== undefined &&
      typeof init !== "object" &&
      typeof init !== "function"
    )
      throw new TypeError("invalid event dictionary");
    const dictionaryValue = dictionary(init);
    const values: Record<string, unknown> = {};
    const names = level >= 3 ? pointerInitFields : level >= 2 ? mouseInitFields : uiInitFields;
    let altitude = false,
      azimuth = false,
      tilt = false;
    const state: UIState = { level, values };
    for (const name of names) {
      const member: unknown = dictionaryValue ? Reflect.get(dictionaryValue, name) : undefined;
      if (name === "coalescedEvents") {
        if (member !== undefined) state.coalesced = pointerSequence(member);
        continue;
      }
      if (name === "predictedEvents") {
        if (member !== undefined) state.predicted = pointerSequence(member);
        continue;
      }
      altitude ||= name === "altitudeAngle" && member !== undefined;
      azimuth ||= name === "azimuthAngle" && member !== undefined;
      tilt ||= (name === "tiltX" || name === "tiltY") && member !== undefined;
      const fallback =
        name === "view" || name === "relatedTarget"
          ? null
          : name === "pointerType"
            ? ""
            : name === "width" || name === "height"
              ? 1
              : name === "altitudeAngle"
                ? Math.PI / 2
                : 0;
      values[name] = uiConvert(name, member === undefined ? fallback : member);
    }
    if (level >= 3) pointerAngles(values, altitude, azimuth, tilt);
    return state;
  }
  const mouseEventKey = Symbol("mouse event");
  const pointerEventKey = Symbol("pointer event");
  class UIEvent extends Event {
    constructor(type: unknown, init: unknown = {}, key?: symbol) {
      if (arguments.length === 0) throw new TypeError("UIEvent requires a type");
      const name = domString(type);
      const level = key === pointerEventKey ? 3 : key === mouseEventKey ? 2 : 1;
      const state = uiInitialization(init, level);
      super(name, {
        bubbles: Boolean(state.values.bubbles),
        cancelable: Boolean(state.values.cancelable),
        composed: Boolean(state.values.composed),
      });
      uiEvents.set(this, state);
    }
    get view(): unknown {
      return uiState(this, 1).values.view;
    }
    get detail(): number {
      return Number(uiState(this, 1).values.detail);
    }
    get which(): number {
      const state = uiState(this, 1);
      return state.level >= 2 ? (Number(state.values.button) + 1) >>> 0 : 0;
    }
  }
  class MouseEvent extends UIEvent {
    constructor(type: unknown, init: unknown = {}, key?: symbol) {
      if (arguments.length === 0) throw new TypeError("MouseEvent requires a type");
      super(type, init, key === pointerEventKey ? pointerEventKey : mouseEventKey);
    }
    getModifierState(key: unknown): boolean {
      const state = uiState(this, 2);
      required(1, arguments.length);
      const name = domString(key);
      const attribute =
        name === "Control"
          ? "ctrlKey"
          : ["Alt", "Shift", "Meta"].includes(name)
            ? `${name.toLowerCase()}Key`
            : `modifier${name}`;
      if (
        !["Control", "Alt", "Shift", "Meta"].includes(name) &&
        !modifierNames.some((known) => known === name)
      )
        return false;
      return Boolean(state.values[attribute]);
    }
  }
  class PointerEvent extends MouseEvent {
    constructor(type: unknown, init: unknown = {}) {
      if (arguments.length === 0) throw new TypeError("PointerEvent requires a type");
      super(type, init, pointerEventKey);
    }
    getCoalescedEvents(): PointerEvent[] {
      return uiState(this, 3).coalesced?.slice() ?? [];
    }
    getPredictedEvents(): PointerEvent[] {
      return uiState(this, 3).predicted?.slice() ?? [];
    }
  }
  function mouseCoordinate(owner: object, name: string): number {
    const state = uiState(owner, 2);
    const axis = name.endsWith("Y") || name === "y" ? "Y" : "X";
    const source = name.startsWith("screen") ? `screen${axis}` : `client${axis}`;
    const number = Number(state.values[source]);
    const fractional =
      state.level >= 3 && !["click", "auxclick", "contextmenu"].includes(eventState(owner).type);
    return fractional
      ? number
      : name.startsWith("offset")
        ? Math.round(number)
        : Math.floor(number);
  }
  for (const [constructor, level, fields] of [
    [UIEvent, 1, ["view", "detail", "which"]],
    [MouseEvent, 2, [...mouseFields, "pageX", "pageY", "offsetX", "offsetY", "x", "y"]],
    [PointerEvent, 3, pointerFields],
  ] as const) {
    Object.defineProperty(constructor, "length", { value: 1, configurable: true });
    Object.defineProperty(constructor.prototype, Symbol.toStringTag, {
      value: constructor.name,
      configurable: true,
    });
    for (const name of fields) {
      const existing = Object.getOwnPropertyDescriptor(constructor.prototype, name);
      if (existing) {
        Object.defineProperty(constructor.prototype, name, { ...existing, enumerable: true });
        continue;
      }
      Object.defineProperty(constructor.prototype, name, {
        get(this: object) {
          const state = uiState(this, level);
          if (
            [
              "clientX",
              "clientY",
              "screenX",
              "screenY",
              "pageX",
              "pageY",
              "offsetX",
              "offsetY",
              "x",
              "y",
            ].includes(name)
          )
            return mouseCoordinate(this, name);
          if (name === "button" && state.level === 2 && state.values.button === -1) return 0;
          return state.values[name];
        },
        enumerable: true,
        configurable: true,
      });
    }
    for (const name of ["getModifierState", "getCoalescedEvents", "getPredictedEvents"]) {
      const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, name);
      if (descriptor)
        Object.defineProperty(constructor.prototype, name, { ...descriptor, enumerable: true });
    }
  }
  class ErrorEvent extends Event {
    constructor(
      type: unknown,
      init: (EventInit & { error?: unknown; message?: unknown; filename?: unknown }) | null = {},
    ) {
      if (arguments.length === 0) throw new TypeError("ErrorEvent requires a type");
      super(type, init);
      errorDetails.set(this, {
        error: init !== null && "error" in init ? init.error : null,
        message: domString(init?.message === undefined ? "" : init.message),
        filename: domString(init?.filename === undefined ? "" : init.filename),
      });
    }
    get error(): unknown {
      const detail = errorDetails.get(this);
      if (!detail) throw new TypeError("Illegal invocation");
      return detail.error;
    }
    get filename(): string {
      const detail = errorDetails.get(this);
      if (!detail) throw new TypeError("Illegal invocation");
      return detail.filename;
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
  function shadowRootOf(target: Target): number | null {
    const id = ids.get(target);
    if (shadowRoots.size === 0 || id === undefined || raw<number>("get", id, "nodeType") === 2)
      return null;
    const root = raw<number>("rootNode", id);
    return raw("shadowInfo", root) === null ? null : root;
  }
  function shadowIncludes(root: number, target: Target | null): boolean {
    const id = target === null ? undefined : ids.get(target);
    return id !== undefined && raw<boolean>("shadowContains", root, String(id));
  }
  function retarget(original: Target, current: Target): Target {
    let target = original;
    for (let root = shadowRootOf(target); root !== null; root = shadowRootOf(target)) {
      if (shadowIncludes(root, current)) break;
      const info = raw<[number, string]>("shadowInfo", root);
      target = node(info[0]);
    }
    return target;
  }
  function closedRootsOf(original: Target): number[] {
    const roots: number[] = [];
    let target = original;
    for (let root = shadowRootOf(target); root !== null; root = shadowRootOf(target)) {
      const info = raw<[number, string]>("shadowInfo", root);
      if (info[1] === "closed") roots.push(root);
      target = node(info[0]);
    }
    return roots;
  }
  function eventPath(target: Target, type: string, composed: boolean): Target[] {
    const path = [target];
    const initialId = ids.get(target);
    if (initialId !== undefined) {
      let id: number = initialId;
      const originRoot = shadowRoots.size === 0 ? null : raw<number>("rootNode", id);
      while (true) {
        let parent: number | null =
          shadowRoots.size === 0 ? null : raw<number | null>("assignedSlot", id);
        parent ??= call<number | null>("relativeNode", id, "parent");
        if (parent === null) {
          const shadow = shadowRoots.has(id) ? raw<[number, string]>("shadowInfo", id) : null;
          if (!shadow || (!composed && id === originRoot)) break;
          parent = shadow[0];
        }
        path.push(node(parent));
        id = parent;
      }
      if (type !== "load" && call<number>("get", id, "nodeType") === 9) path.push(globalThis);
    }
    return path;
  }
  let reporting = false;
  function reportListenerError(error: unknown, filename = "") {
    if (
      ((typeof error === "object" && error !== null) || typeof error === "function") &&
      hasFatal(error)
    )
      throw error;
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
        filename,
      });
      dispatch(globalThis, event, true);
    } finally {
      reporting = false;
    }
  }
  function invoke(item: EventPathItem, event: Event, capture: boolean, phase: number) {
    const target = item.target;
    const state = eventState(event);
    if (state.stopped) return;
    state.current = target;
    state.target = item.adjusted;
    state.phase = state.target === target ? 2 : phase;
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
  type InputActivation = {
    target: HTMLInputElement;
    snapshot: {
      checked: boolean;
      indeterminate: boolean;
      previous: number | null;
      changed: boolean;
    };
  };
  function inputTarget(target: Target): target is HTMLInputElement {
    return textControls.get(target) === "input";
  }
  function startInputActivation(event: Event, state: EventState): InputActivation | null {
    const mouse = uiEvents.get(event);
    if (state.type !== "click" || !mouse || mouse.level < 2 || mouse.values.button !== 0)
      return null;
    const target = state.path.find((item) => inputTarget(item.target))?.target;
    if (!target || !inputTarget(target)) return null;
    const snapshot = raw<InputActivation["snapshot"] | null>(
      "inputActivate",
      textControlId(target, "input"),
      "start",
    );
    return snapshot ? { target, snapshot } : null;
  }
  function finishInputActivation(activation: InputActivation, canceled: boolean): void {
    const { target, snapshot } = activation;
    const deliver = raw<boolean>(
      "inputActivate",
      textControlId(target, "input"),
      canceled ? "cancel" : "commit",
      JSON.stringify(snapshot),
    );
    if (deliver) {
      dispatch(target, new Event("input", { bubbles: true, composed: true }), true);
      dispatch(target, new Event("change", { bubbles: true }), true);
    }
  }
  function dispatch(target: Target, event: Event, trusted = false, legacy = false): boolean {
    checkTarget(target);
    const state = eventState(event);
    if (state.dispatching)
      throw new DOMException("event is already being dispatched", "InvalidStateError");
    state.dispatching = true;
    state.trusted = trusted;
    state.target = legacy ? document : target;
    let finalTarget = state.target;
    let clearTarget = false;
    let activation: InputActivation | null = null;
    let resetCandidates: number[] = [];
    try {
      const original = legacy ? document : target;
      state.path = eventPath(target, state.type, state.composed).map((current) => ({
        target: current,
        adjusted: retarget(original, current),
        closedRoots: closedRootsOf(current),
      }));
      finalTarget = state.path.at(-1)?.adjusted ?? finalTarget;
      clearTarget = shadowRootOf(finalTarget) !== null;
      resetCandidates = formResetCandidates(event, state);
      activation = startInputActivation(event, state);
      for (let index = state.path.length - 1; index > 0; index--) {
        const current = state.path[index];
        if (current) invoke(current, event, true, 1);
      }
      const first = state.path[0];
      if (first) {
        invoke(first, event, true, 2);
        invoke(first, event, false, 2);
      }
      for (const current of state.path.slice(1))
        if (state.bubbles || current.adjusted === current.target) invoke(current, event, false, 3);
    } finally {
      state.target = clearTarget ? null : finalTarget;
      state.dispatching = false;
      state.current = null;
      state.phase = 0;
      state.path = [];
      state.stopped = false;
      state.immediate = false;
      state.passive = false;
    }
    if (activation) finishInputActivation(activation, state.canceled);
    if (!state.canceled) {
      for (const candidate of resetCandidates) {
        const owner = raw<number | null>("formControl", candidate, "reset");
        if (owner !== null) {
          resetForm(node(owner));
          break;
        }
      }
    }
    return !state.canceled;
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
  type Collection = NodeList | HTMLCollection | NamedNodeMap;
  type CollectionItems = readonly (Node | number)[];
  type CollectionKind = "nodes" | "elements" | "attributes";
  type CollectionState = {
    kind: CollectionKind;
    resolve: () => CollectionItems;
    live: boolean;
    count?: () => number;
    at?: (index: number) => Node | number | undefined;
    namedGet?: (name: string) => Node | undefined;
  };
  function collectionNode(value: Node | number | undefined): Node | undefined {
    return typeof value === "number" ? node(value) : value;
  }
  const collections = new WeakMap<object, CollectionState>();
  const childLists = new WeakMap<Node, NodeList>();
  const elementLists = new WeakMap<ParentNode, HTMLCollection>();
  function collectionState(list: Collection, kind?: CollectionKind): CollectionState {
    const state = collections.get(list);
    if (!state || (kind !== undefined && state.kind !== kind))
      throw new TypeError("Illegal invocation");
    return state;
  }
  const nodeArray: Node[] = [];
  const arrayForEach = nodeArray.forEach;
  const arrayValues = nodeArray.values;
  const arrayEntries = nodeArray.entries;
  const arrayKeys = nodeArray.keys;
  const attributeArray: Attr[] = [];
  const attributeValues = attributeArray.values;
  const collectionDescriptor = Object.getOwnPropertyDescriptor;
  const collectionPrototype = Object.getPrototypeOf;
  const collectionGet = Reflect.get;
  const collectionHas = Reflect.has;
  function namedNodes(items: CollectionItems): Map<string, Node> {
    const names = new Map<string, Node>();
    for (const value of items) {
      const item = collectionNode(value);
      if (item instanceof Attr) {
        const name = item.name;
        if (
          item.ownerElement?.namespaceURI === "http://www.w3.org/1999/xhtml" &&
          raw<boolean>("get", idOf(item.ownerElement), "htmlDocument") &&
          /[A-Z]/.test(name)
        )
          continue;
        if (!names.has(name)) names.set(name, item);
        continue;
      }
      if (!(item instanceof Element)) continue;
      const id = item.getAttributeNS(null, "id");
      const name =
        item.namespaceURI === "http://www.w3.org/1999/xhtml"
          ? item.getAttributeNS(null, "name")
          : null;
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
    kind: CollectionKind,
    options: {
      named?: boolean;
      live?: boolean;
      count?: () => number;
      at?: (index: number) => Node | number | undefined;
      indexedSet?: (index: number, value: unknown) => boolean;
      namedGet?: (name: string) => Node | undefined;
    } = {},
  ): T {
    const { named = false, live = false, count } = options;
    const state: CollectionState = count ? { resolve, live, kind, count } : { resolve, live, kind };
    if (options.at) state.at = options.at;
    if (options.namedGet) state.namedGet = options.namedGet;
    const visibleName = (key: string | symbol): Node | undefined =>
      named && typeof key === "string" && !Reflect.has(target, key)
        ? options.namedGet
          ? options.namedGet(key)
          : namedNodes(resolve()).get(key)
        : undefined;
    const proxy: T = new Proxy(target, {
      get(object, key, receiver): unknown {
        const index = propertyIndex(key);
        if (index !== null)
          return (
            collectionNode(options.at ? options.at(index) : resolve()[index]) ??
            collectionGet(object, key, receiver)
          );
        return visibleName(key) ?? Reflect.get(object, key, receiver);
      },
      set(object, key, value: unknown, receiver) {
        const index = propertyIndex(key);
        if (index !== null && options.indexedSet && receiver === proxy)
          return options.indexedSet(index, value);
        return Reflect.set(object, key, value, receiver);
      },
      has(object, key) {
        const index = propertyIndex(key);
        return index !== null
          ? index < resolve().length || collectionHas(object, key)
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
          const value = collectionNode(options.at ? options.at(index) : resolve()[index]);
          return value === undefined
            ? undefined
            : {
                value,
                writable: Boolean(options.indexedSet),
                enumerable: true,
                configurable: true,
              };
        }
        const value = visibleName(key);
        return value === undefined
          ? Reflect.getOwnPropertyDescriptor(object, key)
          : { value, writable: false, enumerable: false, configurable: true };
      },
      defineProperty(object, key, descriptor) {
        const index = propertyIndex(key);
        if (index !== null)
          return options.indexedSet &&
            descriptor.configurable !== false &&
            Object.hasOwn(descriptor, "value")
            ? options.indexedSet(index, descriptor.value)
            : false;
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
  const attributeMaps = new WeakMap<Element, NamedNodeMap>();
  const attributeMapOwners = new WeakMap<NamedNodeMap, Element>();
  function mapOwner(map: NamedNodeMap): Element {
    const owner = attributeMapOwners.get(map);
    if (!owner) throw new TypeError("Illegal invocation");
    return owner;
  }
  class NamedNodeMap {
    constructor(key: symbol) {
      if (key !== internal) throw new TypeError("Illegal constructor");
    }
    get length(): number {
      return raw<number>("attributeNode", attributeElement(mapOwner(this)), "length");
    }
    item(index: number): Attr | null {
      required(1, arguments.length);
      const value = collectionNode(collectionState(this, "attributes").resolve()[index >>> 0]);
      return value instanceof Attr ? value : null;
    }
    getNamedItem(name: unknown): Attr | null {
      required(1, arguments.length);
      return mapOwner(this).getAttributeNode(name);
    }
    getNamedItemNS(namespace: unknown, localName: unknown): Attr | null {
      required(2, arguments.length);
      return mapOwner(this).getAttributeNodeNS(namespace, localName);
    }
    setNamedItem(attribute: Attr): Attr | null {
      required(1, arguments.length);
      return mapOwner(this).setAttributeNode(attribute);
    }
    setNamedItemNS(attribute: Attr): Attr | null {
      required(1, arguments.length);
      return mapOwner(this).setAttributeNodeNS(attribute);
    }
    removeNamedItem(name: unknown): Attr {
      required(1, arguments.length);
      const attribute = this.getNamedItem(name);
      if (!attribute) throw new DOMException("attribute not found", "NotFoundError");
      return mapOwner(this).removeAttributeNode(attribute);
    }
    removeNamedItemNS(namespace: unknown, localName: unknown): Attr {
      required(2, arguments.length);
      const attribute = this.getNamedItemNS(namespace, localName);
      if (!attribute) throw new DOMException("attribute not found", "NotFoundError");
      return mapOwner(this).removeAttributeNode(attribute);
    }
    [Symbol.iterator](): IterableIterator<Attr> {
      const state = collections.get(this);
      return attributeValues.call(state ? iterationView(this, state) : this);
    }
  }
  class NodeList {
    constructor(key: symbol) {
      if (key !== internal) throw new TypeError("Illegal constructor");
    }
    get length(): number {
      return collectionState(this, "nodes").resolve().length;
    }
    item(index: number): Node | null {
      if (arguments.length === 0) throw new TypeError("item requires an index");
      return collectionNode(collectionState(this, "nodes").resolve()[index >>> 0]) ?? null;
    }
    forEach(
      callback: (this: unknown, value: Node, index: number, list: NodeList) => void,
      thisArg?: unknown,
    ) {
      const state = collections.get(this);
      const receiver = state ? iterationView(this, state) : this;
      if (typeof callback !== "function") return arrayForEach.call(receiver, callback, thisArg);
      return arrayForEach.call(receiver, (value, index) =>
        callback.call(thisArg, value, index, this),
      );
    }
    entries(): IterableIterator<[number, Node]> {
      const state = collections.get(this);
      return arrayEntries.call(state ? iterationView(this, state) : this);
    }
    keys(): IterableIterator<number> {
      const state = collections.get(this);
      return arrayKeys.call(state ? iterationView(this, state) : this);
    }
    values(): IterableIterator<Node> {
      const state = collections.get(this);
      return arrayValues.call(state ? iterationView(this, state) : this);
    }
    [Symbol.iterator](): IterableIterator<Node> {
      return this.values();
    }
  }
  function iterationResolver(state: CollectionState): () => CollectionItems {
    if (!state.live) return state.resolve;
    let version = -1;
    let items: CollectionItems = [];
    // Keep IDs only for this iteration; native mutation versions preserve live indices.
    return () => {
      const current = raw<number>("layoutVersion", 0);
      if (version !== current) {
        items = state.resolve();
        version = current;
      }
      return items;
    };
  }
  function* collectionEntries(state: CollectionState): Generator<[number, Node]> {
    const resolve = iterationResolver(state);
    for (let index = 0; ; index++) {
      const value = collectionNode(resolve()[index]);
      if (value === undefined) return;
      yield [index, value];
    }
  }
  function* collectionValues(state: CollectionState): Generator<Node> {
    for (const [, value] of collectionEntries(state)) yield value;
  }
  function iterationView(list: Collection, state: CollectionState) {
    const resolve = iterationResolver(state);
    let current: CollectionItems | undefined;
    return new Proxy(
      {},
      {
        get(_target, key): unknown {
          if (key === "length") {
            current = undefined;
            const normal =
              state.kind === "nodes"
                ? collectionLengths.nodes
                : state.kind === "attributes"
                  ? collectionLengths.attributes
                  : optionListOwners.has(list)
                    ? collectionLengths.options
                    : collectionLengths.elements;
            if (
              collectionPrototype(list) === normal.prototype &&
              collectionDescriptor(list, "length") === undefined &&
              collectionDescriptor(normal.prototype, "length")?.get === normal.descriptor?.get
            ) {
              current = resolve();
              return current.length;
            }
          }
          const index = propertyIndex(key);
          if (index !== null) {
            const items = current ?? resolve();
            current = undefined;
            const value = collectionNode(items[index]);
            if (value !== undefined) return value;
          }
          return collectionGet(list, key, list);
        },
        has(_target, key) {
          const index = propertyIndex(key);
          current = index !== null ? resolve() : undefined;
          if (index !== null && current && index < current.length) return true;
          current = undefined;
          return collectionHas(list, key);
        },
      },
    );
  }
  class HTMLCollection {
    constructor(key: symbol) {
      if (key !== internal) throw new TypeError("Illegal constructor");
    }
    get length(): number {
      const state = collectionState(this, "elements");
      return state.count?.() ?? state.resolve().length;
    }
    item(index: number): Element | null {
      if (arguments.length === 0) throw new TypeError("item requires an index");
      const state = collectionState(this, "elements");
      const converted = idlNumber(index) >>> 0;
      const value = collectionNode(state.at ? state.at(converted) : state.resolve()[converted]);
      return value instanceof Element ? value : null;
    }
    namedItem(name: unknown): Element | null {
      if (arguments.length === 0) throw new TypeError("namedItem requires a name");
      const state = collectionState(this, "elements");
      const key = domString(name);
      if (key === "") return null;
      const value = state.namedGet ? state.namedGet(key) : namedNodes(state.resolve()).get(key);
      return value instanceof Element ? value : null;
    }
    [Symbol.iterator](): IterableIterator<Node> {
      const state = collections.get(this);
      return arrayValues.call(state ? iterationView(this, state) : this);
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
    [NamedNodeMap.prototype, "NamedNodeMap"],
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
        list = makeCollection(
          new NodeList(internal),
          () => call<number[]>("children", idOf(this), "nodes"),
          "nodes",
          { live: true },
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
    cloneNode(deep: unknown = false): Node {
      const copy = node(call<number>("clone", idOf(this), String(Boolean(deep))));
      if (definitions.size > 0) upgradeSubtree(copy);
      return copy;
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
      const id = raw<number | null>("get", idOf(this), "ownerDocument");
      return id === null ? null : documentNode(id);
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
    getRootNode(options: { composed?: unknown } | null = {}): Node {
      const id = idOf(this);
      if (call<number>("get", id, "nodeType") === 2) return this;
      return node(call<number>("rootNode", id, options?.composed ? "composed" : ""));
    }
    hasChildNodes(): boolean {
      return raw<number | null>("relativeNode", idOf(this), "first") !== null;
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
    protected relativeElement(relation: string): Element | null {
      const id = call<number | null>("relativeElement", idOf(this), relation);
      return id === null ? null : element(id);
    }
    get firstElementChild(): Element | null {
      return this.relativeElement("first");
    }
    get lastElementChild(): Element | null {
      return this.relativeElement("last");
    }
    get children(): HTMLCollection {
      let list = elementLists.get(this);
      if (!list) {
        list = makeCollection(
          new HTMLCollection(internal),
          () => call<number[]>("children", idOf(this), "elements"),
          "elements",
          { named: true, live: true },
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
      return makeCollection(new NodeList(internal), () => snapshot, "nodes");
    }
    querySelector(selector: string): Element | null {
      const id = call<number | null>("queryOne", idOf(this), selector);
      return id === null ? null : element(id);
    }
  }
  const tagCollections = new WeakMap<
    Element | Document,
    { mode: string; values: Map<string, HTMLCollection> }
  >();
  function tagElements(owner: Element | Document, qualifiedName: unknown): HTMLCollection {
    const id = idOf(owner);
    const name = domString(qualifiedName);
    const mode = JSON.stringify(raw<boolean>("get", id, "htmlDocument"));
    let owned = tagCollections.get(owner);
    if (owned === undefined || owned.mode !== mode) {
      owned = { mode, values: new Map() };
      tagCollections.set(owner, owned);
    }
    const existing = owned.values.get(name);
    if (existing !== undefined) return existing;
    let snapshot: { version: number; ids: readonly number[] } | undefined;
    const collection = makeCollection(
      new HTMLCollection(internal),
      () => {
        const version = raw<number>("layoutVersion", 0);
        if (snapshot === undefined || snapshot.version !== version) {
          snapshot = { version, ids: call<number[]>("tagElements", id, name, mode) };
        }
        return snapshot.ids;
      },
      "elements",
      { named: true, live: true },
    );
    owned.values.set(name, collection);
    return collection;
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
  function idlNumber(value: unknown): number {
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
        x: idlNumber(x),
        y: idlNumber(y),
        width: idlNumber(width),
        height: idlNumber(height),
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
      rectState(this).x = idlNumber(value);
    }
    override get y(): number {
      return super.y;
    }
    override set y(value: unknown) {
      rectState(this).y = idlNumber(value);
    }
    override get width(): number {
      return super.width;
    }
    override set width(value: unknown) {
      rectState(this).width = idlNumber(value);
    }
    override get height(): number {
      return super.height;
    }
    override set height(value: unknown) {
      rectState(this).height = idlNumber(value);
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
  class Attr extends Node {
    get name(): string {
      return raw("get", attrId(this), "name");
    }
    get localName(): string {
      return raw("get", attrId(this), "localName");
    }
    get namespaceURI(): string | null {
      return raw("get", attrId(this), "namespaceURI");
    }
    get prefix(): string | null {
      return raw("get", attrId(this), "prefix");
    }
    get specified(): boolean {
      attrId(this);
      return true;
    }
    get ownerElement(): Element | null {
      const id = raw<number | null>("get", attrId(this), "ownerElement");
      return id === null ? null : element(id);
    }
    get value(): string {
      return raw("get", attrId(this), "value");
    }
    set value(value: unknown) {
      setAttrValue(this, domString(value));
    }
    override get nodeValue(): string {
      return this.value;
    }
    override set nodeValue(value: string | number | null) {
      setAttrValue(this, domString(value ?? ""));
    }
    override get textContent(): string {
      return this.value;
    }
    override set textContent(value: string | number | null) {
      setAttrValue(this, domString(value ?? ""));
    }
  }
  function attrId(attribute: object): number {
    if (!(attribute instanceof Attr)) throw new TypeError("Expected Attr");
    return idOf(attribute);
  }
  function attributeNode(id: number): Attr {
    const value = node(id);
    if (!(value instanceof Attr)) throw new TypeError("Expected native Attr");
    return value;
  }
  function setAttrValue(attribute: Attr, value: string): void {
    const id = attrId(attribute),
      owner = attribute.ownerElement,
      previous = attribute.value;
    reactions(() => {
      raw("set", id, "value", value);
      if (owner && isHTML(owner))
        customCallback(owner, "attributeChangedCallback", [
          attribute.localName,
          previous,
          value,
          attribute.namespaceURI,
        ]);
    });
  }
  function mutateAttributeNode(
    owner: Element,
    attribute: Attr,
    operation: "attach" | "remove",
  ): Attr | null {
    const ownerId = attributeElement(owner),
      id = attrId(attribute);
    const previous =
      operation === "remove"
        ? attribute.value
        : owner.getAttributeNS(attribute.namespaceURI, attribute.localName);
    const unchanged = operation === "attach" && attribute.ownerElement === owner;
    return reactions(() => {
      const result = raw<number | null>("attributeNode", ownerId, operation, String(id));
      if (!unchanged && isHTML(owner))
        customCallback(owner, "attributeChangedCallback", [
          attribute.localName,
          previous,
          operation === "remove" ? null : attribute.value,
          attribute.namespaceURI,
        ]);
      return result === null ? null : attributeNode(result);
    });
  }
  class Element extends ParentNode {
    get assignedSlot(): HTMLSlotElement | null {
      attributeElement(this);
      return assignedSlot(this);
    }
    get slot(): string {
      return this.getAttributeNS(null, "slot") ?? "";
    }
    set slot(value: unknown) {
      this.setAttributeNS(null, "slot", domString(value));
    }
    attachShadow(init: unknown): ShadowRoot {
      attributeElement(this);
      const options = dictionary(init);
      if (!options) throw new TypeError("ShadowRootInit requires a mode");
      const mode = domString(Reflect.get(options, "mode"));
      if (mode !== "open" && mode !== "closed") throw new TypeError("Invalid shadow root mode");
      for (const key of ["clonable", "serializable", "delegatesFocus"])
        if (Reflect.get(options, key))
          throw new DOMException(`shadow ${key} is not implemented`, "NotSupportedError");
      const assignment: unknown = Reflect.get(options, "slotAssignment");
      if (assignment !== undefined) {
        const converted = domString(assignment);
        if (converted !== "named" && converted !== "manual")
          throw new TypeError("Invalid slot assignment mode");
        if (converted === "manual")
          throw new DOMException("manual slot assignment is not implemented", "NotSupportedError");
      }
      const registry: unknown = Reflect.get(options, "customElementRegistry");
      if (registry !== undefined && registry !== customElements)
        throw new DOMException("scoped shadow registries are not implemented", "NotSupportedError");
      const name = this.localName;
      if (
        this.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
        !(
          validCustomName(name) ||
          [
            "article",
            "aside",
            "blockquote",
            "body",
            "div",
            "footer",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "header",
            "main",
            "nav",
            "p",
            "section",
            "span",
          ].includes(name)
        )
      )
        throw new DOMException("element is not a valid shadow host", "NotSupportedError");
      if (definitions.get(name)?.disableShadow)
        throw new DOMException("custom element disables shadow roots", "NotSupportedError");
      const root = node(call<number>("attachShadow", idOf(this), mode));
      if (!(root instanceof ShadowRoot)) throw new TypeError("Expected ShadowRoot");
      return root;
    }
    get shadowRoot(): ShadowRoot | null {
      const id = call<number | null>("shadowRoot", attributeElement(this));
      if (id === null) return null;
      const root = node(id);
      if (!(root instanceof ShadowRoot)) throw new TypeError("Expected ShadowRoot");
      return root;
    }
    insertAdjacentElement(where: unknown, value: unknown): Element | null {
      attributeElement(this);
      required(2, arguments.length);
      const position = domString(where);
      if (!(value instanceof Element)) throw new TypeError("expected Element");
      idOf(value);
      return reactions(() => insertAdjacent(this, position, value));
    }
    get attributes(): NamedNodeMap {
      const id = attributeElement(this);
      let map = attributeMaps.get(this);
      if (!map) {
        map = makeCollection(
          new NamedNodeMap(internal),
          () => raw<number[]>("attributeNode", id, "list"),
          "attributes",
          { named: true, live: true },
        );
        attributeMaps.set(this, map);
        attributeMapOwners.set(map, this);
      }
      return map;
    }
    getAttributeNode(name: unknown): Attr | null {
      required(1, arguments.length);
      const id = raw<number | null>(
        "attributeNode",
        attributeElement(this),
        "named",
        domString(name),
      );
      return id === null ? null : attributeNode(id);
    }
    getAttributeNodeNS(namespace: unknown, localName: unknown): Attr | null {
      required(2, arguments.length);
      const id = raw<number | null>(
        "attributeNode",
        attributeElement(this),
        "ns",
        JSON.stringify([attributeNamespace(namespace), domString(localName)]),
      );
      return id === null ? null : attributeNode(id);
    }
    setAttributeNode(attribute: Attr): Attr | null {
      required(1, arguments.length);
      return mutateAttributeNode(this, attribute, "attach");
    }
    setAttributeNodeNS(attribute: Attr): Attr | null {
      required(1, arguments.length);
      return mutateAttributeNode(this, attribute, "attach");
    }
    removeAttributeNode(attribute: Attr): Attr {
      required(1, arguments.length);
      const removed = mutateAttributeNode(this, attribute, "remove");
      if (!removed) throw new DOMException("attribute not found", "NotFoundError");
      return removed;
    }
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
      return this.getAttributeNS(null, "id") ?? "";
    }
    set id(value: string | number | null) {
      this.setAttributeNS(null, "id", value);
    }
    get className(): string {
      return this.getAttributeNS(null, "class") ?? "";
    }
    set className(value: string | number | null) {
      this.setAttributeNS(null, "class", value);
    }
    getAttribute(name: unknown): string | null {
      if (arguments.length < 1) throw new TypeError("name is required");
      return call("attr", attributeElement(this), domString(name));
    }
    setAttribute(name: unknown, value: unknown): void {
      if (arguments.length < 2) throw new TypeError("name and value are required");
      call("setAttr", attributeElement(this), domString(name), domString(value));
    }
    hasAttribute(name: unknown): boolean {
      if (arguments.length < 1) throw new TypeError("name is required");
      return raw("hasAttr", attributeElement(this), domString(name));
    }
    removeAttribute(name: unknown): void {
      if (arguments.length < 1) throw new TypeError("name is required");
      call("removeAttr", attributeElement(this), domString(name));
    }
    getAttributeNS(namespace: unknown, localName: unknown): string | null {
      if (arguments.length < 2) throw new TypeError("namespace and localName are required");
      return raw(
        "attrNS",
        attributeElement(this),
        JSON.stringify([attributeNamespace(namespace), domString(localName)]),
      );
    }
    hasAttributeNS(namespace: unknown, localName: unknown): boolean {
      if (arguments.length < 2) throw new TypeError("namespace and localName are required");
      return raw(
        "hasAttrNS",
        attributeElement(this),
        JSON.stringify([attributeNamespace(namespace), domString(localName)]),
      );
    }
    setAttributeNS(namespace: unknown, qualifiedName: unknown, value: unknown): void {
      if (arguments.length < 3)
        throw new TypeError("namespace, qualifiedName and value are required");
      mutateAttributeNS(
        this,
        "setAttrNS",
        attributeNamespace(namespace),
        domString(qualifiedName),
        domString(value),
      );
    }
    removeAttributeNS(namespace: unknown, localName: unknown): void {
      if (arguments.length < 2) throw new TypeError("namespace and localName are required");
      mutateAttributeNS(this, "removeAttrNS", attributeNamespace(namespace), domString(localName));
    }
    getAttributeNames(): string[] {
      return raw("attributeNames", attributeElement(this));
    }
    hasAttributes(): boolean {
      return raw<string[]>("attributeNames", attributeElement(this)).length !== 0;
    }
    toggleAttribute(name: unknown, force?: unknown): boolean {
      if (arguments.length < 1) throw new TypeError("name is required");
      const id = attributeElement(this),
        converted = domString(name);
      const present = call<string | null>("attr", id, converted) !== null;
      const wanted = arguments.length < 2 ? !present : Boolean(force);
      // Native set validates newly created names; explicit validation also covers removal/no-op.
      if (converted.length === 0 || /[\0\t\n\r\f />=]/.test(converted))
        throw new DOMException("invalid attribute local name", "InvalidCharacterError");
      if (wanted && !present) call("setAttr", id, converted, "");
      if (!wanted && present) call("removeAttr", id, converted);
      return wanted;
    }
  }
  function insertAdjacent(target: Element, where: string, child: Element): Element | null {
    const position = where.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    let parent: Node | null;
    let reference: Node | null;
    switch (position) {
      case "beforebegin":
        parent = relative(target, "parent");
        reference = target;
        break;
      case "afterend":
        parent = relative(target, "parent");
        reference = relative(target, "next");
        break;
      case "afterbegin":
        parent = target;
        reference = relative(target, "first");
        break;
      case "beforeend":
        parent = target;
        reference = null;
        break;
      default:
        throw new DOMException("Invalid adjacent position", "SyntaxError");
    }
    if (!parent) return null;
    insertNode(parent, child, reference);
    return child;
  }
  Object.defineProperty(Element.prototype, "insertAdjacentElement", {
    ...Object.getOwnPropertyDescriptor(Element.prototype, "insertAdjacentElement"),
    enumerable: true,
  });
  function attributeElement(owner: object): number {
    if (!(owner instanceof Element)) throw new TypeError("Illegal invocation");
    return idOf(owner);
  }
  function attributeNamespace(value: unknown): string {
    return value === null || value === undefined ? "" : domString(value);
  }
  function mutateAttributeNS(
    owner: Element,
    operation: "setAttrNS" | "removeAttrNS",
    namespace: string,
    name: string,
    value = "",
  ): void {
    const id = attributeElement(owner);
    const local =
      operation === "setAttrNS" && name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
    reactions(() => {
      const previous = raw<string | null>("attrNS", id, JSON.stringify([namespace, local]));
      raw(operation, id, JSON.stringify([namespace, name]), value);
      if (isHTML(owner) && (operation === "setAttrNS" || previous !== null))
        customCallback(owner, "attributeChangedCallback", [
          local,
          previous,
          operation === "setAttrNS" ? value : null,
          namespace || null,
        ]);
    });
  }
  function elementGeometry(owner: object, name: string): number {
    if (!(owner instanceof Element)) throw new TypeError("Illegal invocation");
    return call("geometry", idOf(owner), name);
  }
  function setElementScroll(owner: object, name: string, value: unknown): void {
    if (!(owner instanceof Element)) throw new TypeError("Illegal invocation");
    const number = idlNumber(value);
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
    return raw("attrNS", htmlId(owner), JSON.stringify(["", name]));
  }
  function hasHtmlAttribute(owner: object, name: string): boolean {
    return raw("hasAttrNS", htmlId(owner), JSON.stringify(["", name]));
  }
  function reflectString(owner: object, name: string, value: unknown): void {
    htmlId(owner);
    if (owner instanceof Element) mutateAttributeNS(owner, "setAttrNS", "", name, domString(value));
  }
  function reflectBoolean(owner: object, name: string, value: unknown): void {
    htmlId(owner);
    if (owner instanceof Element)
      mutateAttributeNS(owner, value ? "setAttrNS" : "removeAttrNS", "", name);
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
    if (key === "webkitLineClamp") return "-webkit-line-clamp";
    if (key === "webkitBoxOrient") return "-webkit-box-orient";
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
  const clicking = new WeakSet<object>();
  class HTMLElement extends Element {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) return constructHTML(new.target);
      super(internal, id);
      htmlElements.add(this);
      return this;
    }
    click(): void {
      const id = htmlId(this);
      if (clicking.has(this) || call<boolean>("clickDisabled", id)) return;
      clicking.add(this);
      try {
        dispatch(
          this,
          new PointerEvent("click", {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: globalThis,
            pointerId: -1,
          }),
        );
      } finally {
        clicking.delete(this);
      }
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
      return hasHtmlAttribute(this, "inert");
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
  const clickDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "click");
  if (clickDescriptor)
    Object.defineProperty(HTMLElement.prototype, "click", { ...clickDescriptor, enumerable: true });
  const formElements = new WeakSet<object>();
  const resettingForms = new WeakSet<object>();
  function formResetCandidates(event: Event, state: EventState): number[] {
    const mouse = uiEvents.get(event);
    if (state.type !== "click" || !mouse || mouse.level < 2) return [];
    const candidates: number[] = [];
    for (const item of state.path) {
      if (!htmlElements.has(item.target)) continue;
      const id = htmlId(item.target);
      const kind = raw<number>("formControl", id, "candidate");
      if (kind === 2) break;
      if (kind === 1) candidates.push(id);
    }
    return candidates;
  }
  function resetForm(target: Node): void {
    if (!formElements.has(target)) throw new TypeError("Illegal invocation");
    const id = htmlId(target);
    if (resettingForms.has(target)) return;
    resettingForms.add(target);
    try {
      if (dispatch(target, new Event("reset", { bubbles: true, cancelable: true }), true))
        raw("formReset", id);
    } finally {
      resettingForms.delete(target);
    }
  }
  class HTMLFormElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      formElements.add(this);
    }
    reset(): void {
      resetForm(this);
    }
  }
  Object.defineProperty(HTMLFormElement, "length", { value: 0, configurable: true });
  Object.defineProperty(HTMLFormElement.prototype, Symbol.toStringTag, {
    value: "HTMLFormElement",
    configurable: true,
  });
  Object.defineProperty(HTMLFormElement.prototype, "reset", {
    ...Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, "reset"),
    enumerable: true,
  });
  const buttonElements = new WeakSet<object>();
  function buttonId(owner: object): number {
    if (!buttonElements.has(owner)) throw new TypeError("Illegal invocation");
    return htmlId(owner);
  }
  class HTMLButtonElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      buttonElements.add(this);
    }
    get form(): Element | null {
      const id = raw<number | null>("formOwner", buttonId(this));
      return id === null ? null : element(id);
    }
    get type(): string {
      return raw("formControl", buttonId(this), "type");
    }
    set type(value: unknown) {
      buttonId(this);
      reflectString(this, "type", value);
    }
  }
  Object.defineProperty(HTMLButtonElement, "length", { value: 0, configurable: true });
  Object.defineProperty(HTMLButtonElement.prototype, Symbol.toStringTag, {
    value: "HTMLButtonElement",
    configurable: true,
  });
  for (const name of ["form", "type"]) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, name);
    if (descriptor)
      Object.defineProperty(HTMLButtonElement.prototype, name, { ...descriptor, enumerable: true });
  }
  for (const name of ["name", "value"])
    Object.defineProperty(HTMLButtonElement.prototype, name, {
      get(this: object) {
        buttonId(this);
        return htmlAttribute(this, name) ?? "";
      },
      set(this: object, value: unknown) {
        buttonId(this);
        reflectString(this, name, value);
      },
      enumerable: true,
      configurable: true,
    });
  for (const [name, attribute] of [
    ["disabled", "disabled"],
    ["formNoValidate", "formnovalidate"],
  ] as const)
    Object.defineProperty(HTMLButtonElement.prototype, name, {
      get(this: object) {
        buttonId(this);
        return hasHtmlAttribute(this, attribute);
      },
      set(this: object, value: unknown) {
        buttonId(this);
        reflectBoolean(this, attribute, value);
      },
      enumerable: true,
      configurable: true,
    });
  const optionElements = new WeakSet<object>();
  function optionId(owner: object): number {
    if (!optionElements.has(owner)) throw new TypeError("Illegal invocation");
    return htmlId(owner);
  }
  class HTMLOptionElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      optionElements.add(this);
    }
    get text(): string {
      return raw("option", optionId(this), "text");
    }
    set text(value: unknown) {
      call("set", optionId(this), "textContent", domString(value));
    }
    get index(): number {
      return raw("option", optionId(this), "index");
    }
    get form(): Element | null {
      const id = raw<number | null>("option", optionId(this), "form");
      return id === null ? null : element(id);
    }
  }
  Object.defineProperty(HTMLOptionElement, "length", { value: 0, configurable: true });
  Object.defineProperty(HTMLOptionElement.prototype, Symbol.toStringTag, {
    value: "HTMLOptionElement",
    configurable: true,
  });
  for (const name of ["text", "index", "form"]) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, name);
    if (descriptor)
      Object.defineProperty(HTMLOptionElement.prototype, name, { ...descriptor, enumerable: true });
  }
  for (const name of ["value", "label"])
    Object.defineProperty(HTMLOptionElement.prototype, name, {
      get(this: object) {
        return raw<string>("option", optionId(this), name);
      },
      set(this: object, value: unknown) {
        optionId(this);
        reflectString(this, name, value);
      },
      enumerable: true,
      configurable: true,
    });
  for (const [name, attribute] of [
    ["disabled", "disabled"],
    ["defaultSelected", "selected"],
  ] as const)
    Object.defineProperty(HTMLOptionElement.prototype, name, {
      get(this: object) {
        optionId(this);
        return hasHtmlAttribute(this, attribute);
      },
      set(this: object, value: unknown) {
        optionId(this);
        reflectBoolean(this, attribute, value);
      },
      enumerable: true,
      configurable: true,
    });
  const selectElements = new WeakSet<object>();
  const selectOptions = new WeakMap<object, HTMLOptionsCollection>();
  const selectedOptionLists = new WeakMap<object, HTMLCollection>();
  const optionListOwners = new WeakMap<object, HTMLSelectElement>();
  function selectId(owner: object): number {
    if (!selectElements.has(owner)) throw new TypeError("Illegal invocation");
    return htmlId(owner);
  }
  function optionsOwner(list: object): HTMLSelectElement {
    const owner = optionListOwners.get(list);
    if (!owner) throw new TypeError("Illegal invocation");
    return owner;
  }
  function selectItem(owner: object, value: number | string, operation = "item"): Element | null {
    const id = raw<number | null>("selection", selectId(owner), operation, String(value));
    return id === null ? null : element(id);
  }
  function resizeSelect(owner: object, value: unknown): void {
    const id = selectId(owner);
    call("selection", id, "setLength", String(idlNumber(value) >>> 0));
  }
  function setOptionIndex(owner: object, index: number, value: unknown): boolean {
    const id = selectId(owner);
    const old = selectItem(owner, index);
    if (value === null || value === undefined) {
      if (old) call("remove", idOf(old));
      return true;
    }
    if (typeof value !== "object" || !optionElements.has(value))
      throw new TypeError("Expected option");
    if (old) {
      const parent = raw<number>("relativeNode", idOf(old), "parent");
      call("replace", parent, String(idOf(old)), String(idOf(value)));
    } else {
      if (index > raw<number>("selection", id, "length")) resizeSelect(owner, index);
      call("append", id, "", String(idOf(value)));
    }
    return true;
  }
  const optgroupElements = new WeakSet<object>();
  class HTMLOptGroupElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      optgroupElements.add(this);
    }
  }
  Object.defineProperty(HTMLOptGroupElement, "length", { value: 0, configurable: true });
  Object.defineProperty(HTMLOptGroupElement.prototype, Symbol.toStringTag, {
    value: "HTMLOptGroupElement",
    configurable: true,
  });
  for (const name of ["disabled", "label"])
    Object.defineProperty(HTMLOptGroupElement.prototype, name, {
      get(this: object) {
        if (!optgroupElements.has(this)) throw new TypeError("Illegal invocation");
        return name === "disabled"
          ? hasHtmlAttribute(this, name)
          : (htmlAttribute(this, name) ?? "");
      },
      set(this: object, value: unknown) {
        if (!optgroupElements.has(this)) throw new TypeError("Illegal invocation");
        if (name === "disabled") reflectBoolean(this, name, value);
        else reflectString(this, name, value);
      },
      enumerable: true,
      configurable: true,
    });
  function addOption(owner: object, option: unknown, before?: unknown): void {
    const id = selectId(owner);
    if (
      typeof option !== "object" ||
      option === null ||
      (!optionElements.has(option) && !optgroupElements.has(option))
    )
      throw new TypeError("Expected option or optgroup");
    const reference =
      before === undefined || before === null
        ? null
        : before instanceof HTMLElement
          ? before
          : selectItem(owner, idlNumber(before) | 0);
    if (reference !== null) {
      const referenceId = idOf(reference);
      if (referenceId === id || raw<number | null>("relativeNode", referenceId, "parent") !== id)
        throw new DOMException("reference is outside select", "NotFoundError");
      call("insert", id, String(referenceId), String(idOf(option)));
    } else call("append", id, "", String(idOf(option)));
  }
  function removeOption(owner: object, index: unknown): void {
    selectId(owner);
    const item = selectItem(owner, idlNumber(index) | 0);
    if (item) call("remove", idOf(item));
  }
  function selectProxy(target: HTMLSelectElement, id: number): HTMLSelectElement {
    const proxy: HTMLSelectElement = new Proxy(target, {
      get(object, key, receiver: HTMLSelectElement): unknown {
        const index = propertyIndex(key);
        return index === null
          ? Reflect.get(object, key, receiver)
          : (selectItem(proxy, index) ?? undefined);
      },
      set(object, key, value: unknown, receiver: HTMLSelectElement) {
        const index = propertyIndex(key);
        return index === null
          ? Reflect.set(object, key, value, receiver)
          : receiver === proxy
            ? setOptionIndex(proxy, index, value)
            : Reflect.set(object, key, value, receiver);
      },
      has(object, key) {
        const index = propertyIndex(key);
        return index === null
          ? Reflect.has(object, key)
          : index < raw<number>("selection", id, "length");
      },
      ownKeys(object) {
        return [
          ...Array.from({ length: raw<number>("selection", id, "length") }, (_, index) =>
            String(index),
          ),
          ...Reflect.ownKeys(object),
        ];
      },
      getOwnPropertyDescriptor(object, key) {
        const index = propertyIndex(key);
        if (index === null) return Reflect.getOwnPropertyDescriptor(object, key);
        const value = selectItem(proxy, index);
        return value === null
          ? undefined
          : { value, writable: true, enumerable: true, configurable: true };
      },
      defineProperty(object, key, descriptor) {
        const index = propertyIndex(key);
        if (index === null) return Reflect.defineProperty(object, key, descriptor);
        return (
          descriptor.configurable !== false &&
          Object.hasOwn(descriptor, "value") &&
          setOptionIndex(proxy, index, descriptor.value)
        );
      },
      deleteProperty(object, key) {
        const index = propertyIndex(key);
        return index === null
          ? Reflect.deleteProperty(object, key)
          : index >= raw<number>("selection", id, "length");
      },
      preventExtensions() {
        return false;
      },
    });
    ids.set(proxy, id);
    nodes.set(id, proxy);
    htmlElements.add(proxy);
    targets.add(proxy);
    selectElements.add(proxy);
    return proxy;
  }
  class HTMLOptionsCollection extends HTMLCollection {
    override get length(): number {
      return raw("selection", selectId(optionsOwner(this)), "length");
    }
    override set length(value: unknown) {
      resizeSelect(optionsOwner(this), value);
    }
    add(option: unknown, before?: unknown): void {
      const owner = optionsOwner(this);
      if (arguments.length === 0) throw new TypeError("add requires an option");
      addOption(owner, option, before);
    }
    remove(index: unknown): void {
      const owner = optionsOwner(this);
      if (arguments.length === 0) throw new TypeError("remove requires an index");
      removeOption(owner, index);
    }
    override namedItem(name: unknown): Element | null {
      const owner = optionsOwner(this);
      if (arguments.length === 0) throw new TypeError("namedItem requires a name");
      return selectItem(owner, domString(name), "namedItem");
    }
    get selectedIndex(): number {
      return raw("selection", selectId(optionsOwner(this)), "selectedIndex");
    }
    set selectedIndex(value: unknown) {
      raw(
        "selection",
        selectId(optionsOwner(this)),
        "setSelectedIndex",
        String(idlNumber(value) | 0),
      );
    }
  }
  const collectionLengths = {
    nodes: {
      prototype: NodeList.prototype,
      descriptor: collectionDescriptor(NodeList.prototype, "length"),
    },
    elements: {
      prototype: HTMLCollection.prototype,
      descriptor: collectionDescriptor(HTMLCollection.prototype, "length"),
    },
    attributes: {
      prototype: NamedNodeMap.prototype,
      descriptor: collectionDescriptor(NamedNodeMap.prototype, "length"),
    },
    options: {
      prototype: HTMLOptionsCollection.prototype,
      descriptor: collectionDescriptor(HTMLOptionsCollection.prototype, "length"),
    },
  };
  function selectOptionList(owner: HTMLSelectElement): HTMLOptionsCollection {
    const id = selectId(owner);
    let list = selectOptions.get(owner);
    if (!list) {
      list = makeCollection(
        new HTMLOptionsCollection(internal),
        () => raw<number[]>("selection", id, "options"),
        "elements",
        {
          named: true,
          live: true,
          count: () => raw<number>("selection", id, "length"),
          at: (index) => selectItem(owner, index) ?? undefined,
          indexedSet: (index, value) => setOptionIndex(owner, index, value),
          namedGet: (name) => selectItem(owner, name, "namedItem") ?? undefined,
        },
      );
      optionListOwners.set(list, owner);
      selectOptions.set(owner, list);
    }
    return list;
  }
  class HTMLSelectElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      selectElements.add(this);
      return selectProxy(this, id);
    }
    get options(): HTMLOptionsCollection {
      return selectOptionList(this);
    }
    get selectedOptions(): HTMLCollection {
      const id = selectId(this);
      let list = selectedOptionLists.get(this);
      if (!list) {
        list = makeCollection(
          new HTMLCollection(internal),
          () => raw<number[]>("selection", id, "selectedOptions"),
          "elements",
          {
            named: true,
            live: true,
            count: () => raw<number>("selection", id, "selectedLength"),
            at: (index) => selectItem(this, index, "selectedItem") ?? undefined,
            namedGet: (name) => selectItem(this, name, "selectedNamedItem") ?? undefined,
          },
        );
        selectedOptionLists.set(this, list);
      }
      return list;
    }
    get length(): number {
      return raw("selection", selectId(this), "length");
    }
    set length(value: unknown) {
      resizeSelect(this, value);
    }
    get selectedIndex(): number {
      return raw("selection", selectId(this), "selectedIndex");
    }
    set selectedIndex(value: unknown) {
      raw("selection", selectId(this), "setSelectedIndex", String(idlNumber(value) | 0));
    }
    get value(): string {
      return raw("selection", selectId(this), "value");
    }
    set value(value: unknown) {
      raw("selection", selectId(this), "setValue", domString(value));
    }
    get type(): string {
      selectId(this);
      return hasHtmlAttribute(this, "multiple") ? "select-multiple" : "select-one";
    }
    get form(): Element | null {
      const id = raw<number | null>("formOwner", selectId(this));
      return id === null ? null : element(id);
    }
    get size(): number {
      return raw("selection", selectId(this), "size");
    }
    set size(value: unknown) {
      selectId(this);
      const size = idlNumber(value) >>> 0;
      reflectString(this, "size", String(size > 2147483647 ? 0 : size));
    }
    item(index: number): Element | null {
      selectId(this);
      if (arguments.length === 0) throw new TypeError("item requires an index");
      return selectItem(this, idlNumber(index) >>> 0);
    }
    namedItem(name: unknown): Element | null {
      selectId(this);
      if (arguments.length === 0) throw new TypeError("namedItem requires a name");
      return selectItem(this, domString(name), "namedItem");
    }
    add(option: unknown, before?: unknown): void {
      selectId(this);
      if (arguments.length === 0) throw new TypeError("add requires an option");
      addOption(this, option, before);
    }
    override remove(index?: unknown): void {
      const id = selectId(this);
      if (arguments.length === 0) call("remove", id);
      else removeOption(this, index);
    }
    [Symbol.iterator](): Generator<Node> {
      selectId(this);
      return collectionValues(collectionState(selectOptionList(this)));
    }
  }
  Object.defineProperty(HTMLOptionElement.prototype, "selected", {
    get(this: object) {
      return raw<boolean>("selection", optionId(this), "selected");
    },
    set(this: object, value: unknown) {
      raw("selection", optionId(this), "setSelected", String(Boolean(value)));
    },
    enumerable: true,
    configurable: true,
  });
  for (const [prototype, tag] of [
    [HTMLSelectElement.prototype, "HTMLSelectElement"],
    [HTMLOptionsCollection.prototype, "HTMLOptionsCollection"],
  ] as const) {
    Object.defineProperty(prototype, Symbol.toStringTag, { value: tag, configurable: true });
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (descriptor) Object.defineProperty(prototype, name, { ...descriptor, enumerable: true });
    }
  }
  Object.defineProperty(HTMLSelectElement, "length", { value: 0, configurable: true });
  Object.defineProperty(HTMLOptionsCollection, "length", { value: 0, configurable: true });
  for (const name of ["multiple", "disabled", "required", "autofocus"])
    Object.defineProperty(HTMLSelectElement.prototype, name, {
      get(this: object) {
        selectId(this);
        return hasHtmlAttribute(this, name);
      },
      set(this: object, value: unknown) {
        selectId(this);
        reflectBoolean(this, name, value);
      },
      enumerable: true,
      configurable: true,
    });
  Object.defineProperty(HTMLSelectElement.prototype, "name", {
    get(this: object) {
      selectId(this);
      return htmlAttribute(this, "name") ?? "";
    },
    set(this: object, value: unknown) {
      selectId(this);
      reflectString(this, "name", value);
    },
    enumerable: true,
    configurable: true,
  });
  function Option(
    text: unknown = "",
    value?: unknown,
    defaultSelected?: unknown,
    selected?: unknown,
  ): HTMLOptionElement {
    if (!new.target) throw new TypeError("Illegal constructor");
    const content = domString(text);
    const attribute = value === undefined ? undefined : domString(value);
    const id = raw<number>("create", 0, "option");
    const option = node(id);
    if (!(option instanceof HTMLOptionElement)) throw new TypeError("Expected option");
    if (content !== "") call("set", id, "textContent", content);
    if (attribute !== undefined) reflectString(option, "value", attribute);
    if (defaultSelected) reflectBoolean(option, "selected", true);
    raw("selection", id, "setFactorySelected", String(Boolean(selected)));
    return option;
  }
  Object.defineProperty(Option, "prototype", {
    value: HTMLOptionElement.prototype,
    writable: false,
  });
  const textControls = new WeakMap<object, "input" | "textarea">();
  function textControlId(owner: object, kind: "input" | "textarea"): number {
    if (textControls.get(owner) !== kind) throw new TypeError("Illegal invocation");
    return idOf(owner);
  }
  const inputTypes = new Set([
    "hidden",
    "text",
    "search",
    "tel",
    "url",
    "email",
    "password",
    "date",
    "month",
    "week",
    "time",
    "datetime-local",
    "number",
    "range",
    "color",
    "checkbox",
    "radio",
    "file",
    "submit",
    "image",
    "reset",
    "button",
  ]);
  class HTMLInputElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      textControls.set(this, "input");
    }
    get form(): Element | null {
      const id = raw<number | null>("formOwner", textControlId(this, "input"));
      return id === null ? null : element(id);
    }
    get value(): string {
      return raw("controlValue", textControlId(this, "input"), "input");
    }
    set value(value: unknown) {
      call(
        "setControlValue",
        textControlId(this, "input"),
        "input",
        value === null ? "" : domString(value),
      );
    }
    get checked(): boolean {
      return raw("inputState", textControlId(this, "input"), "checked");
    }
    set checked(value: unknown) {
      call("setInputState", textControlId(this, "input"), "checked", String(Boolean(value)));
    }
    get indeterminate(): boolean {
      return raw("inputState", textControlId(this, "input"), "indeterminate");
    }
    set indeterminate(value: unknown) {
      call("setInputState", textControlId(this, "input"), "indeterminate", String(Boolean(value)));
    }
    get defaultChecked(): boolean {
      textControlId(this, "input");
      return hasHtmlAttribute(this, "checked");
    }
    set defaultChecked(value: unknown) {
      textControlId(this, "input");
      reflectBoolean(this, "checked", value);
    }
    get defaultValue(): string {
      textControlId(this, "input");
      return htmlAttribute(this, "value") ?? "";
    }
    set defaultValue(value: unknown) {
      textControlId(this, "input");
      reflectString(this, "value", value);
    }
    get type(): string {
      textControlId(this, "input");
      const value = (htmlAttribute(this, "type") ?? "").replace(/[A-Z]/g, (letter) =>
        letter.toLowerCase(),
      );
      return inputTypes.has(value) ? value : "text";
    }
    set type(value: unknown) {
      textControlId(this, "input");
      reflectString(this, "type", value);
    }
  }
  class HTMLTextAreaElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      textControls.set(this, "textarea");
    }
    get form(): Element | null {
      const id = raw<number | null>("formOwner", textControlId(this, "textarea"));
      return id === null ? null : element(id);
    }
    get value(): string {
      return raw("controlValue", textControlId(this, "textarea"), "textarea");
    }
    set value(value: unknown) {
      call(
        "setControlValue",
        textControlId(this, "textarea"),
        "textarea",
        value === null ? "" : domString(value),
      );
    }
    get defaultValue(): string {
      return raw("controlDefault", textControlId(this, "textarea"));
    }
    set defaultValue(value: unknown) {
      textControlId(this, "textarea");
      this.textContent = domString(value);
    }
    get textLength(): number {
      textControlId(this, "textarea");
      return this.value.length;
    }
    get type(): string {
      textControlId(this, "textarea");
      return "textarea";
    }
  }
  for (const [constructor, kind] of [
    [HTMLInputElement, "input"],
    [HTMLTextAreaElement, "textarea"],
  ] as const) {
    const prototype = constructor.prototype;
    Object.defineProperty(constructor, "length", { value: 0, configurable: true });
    Object.defineProperty(prototype, Symbol.toStringTag, {
      value: constructor.name,
      configurable: true,
    });
    for (const name of [
      "value",
      "defaultValue",
      "type",
      "textLength",
      "checked",
      "defaultChecked",
      "indeterminate",
      "form",
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (descriptor) Object.defineProperty(prototype, name, { ...descriptor, enumerable: true });
    }
    for (const name of ["name", "placeholder"])
      Object.defineProperty(prototype, name, {
        get(this: object) {
          textControlId(this, kind);
          return htmlAttribute(this, name) ?? "";
        },
        set(this: object, value: unknown) {
          textControlId(this, kind);
          reflectString(this, name, value);
        },
        enumerable: true,
        configurable: true,
      });
    for (const [name, attribute] of [
      ["disabled", "disabled"],
      ["required", "required"],
      ["readOnly", "readonly"],
      ...(kind === "input" ? [["multiple", "multiple"] as const] : []),
    ] as const)
      Object.defineProperty(prototype, name, {
        get(this: object) {
          textControlId(this, kind);
          return hasHtmlAttribute(this, attribute);
        },
        set(this: object, value: unknown) {
          textControlId(this, kind);
          reflectBoolean(this, attribute, value);
        },
        enumerable: true,
        configurable: true,
      });
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
      if (inputSize > 65_536) failLimit("URL query input limit exceeded");
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
            if (sequenceSize > 65_536) failLimit("URL query input limit exceeded");
            pair.push(converted);
          }
          if (sequenceSize > 65_536) failLimit("URL query input limit exceeded");
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
  const imageElements = new WeakSet<object>();
  function imageId(owner: object): number {
    if (!imageElements.has(owner)) throw new TypeError("Illegal invocation");
    return idOf(owner);
  }
  function imageInfo(owner: object) {
    return call<{
      complete: boolean;
      currentSrc: string;
      naturalWidth: number;
      naturalHeight: number;
    }>("image", imageId(owner));
  }
  class HTMLImageElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      imageElements.add(this);
      imageInfo(this);
    }
    get src(): string {
      const value = call<string | null>("attr", imageId(this), "src");
      if (value === null) return "";
      return linkValue("get", "href", value, documentBase()) ?? "";
    }
    set src(value: unknown) {
      call("setAttr", imageId(this), "src", usvString(value));
    }
    get srcset(): string {
      return call<string | null>("attr", imageId(this), "srcset") ?? "";
    }
    set srcset(value: unknown) {
      call("setAttr", imageId(this), "srcset", domString(value));
    }
    get sizes(): string {
      return call<string | null>("attr", imageId(this), "sizes") ?? "";
    }
    set sizes(value: unknown) {
      call("setAttr", imageId(this), "sizes", domString(value));
    }
    get alt(): string {
      return call<string | null>("attr", imageId(this), "alt") ?? "";
    }
    set alt(value: unknown) {
      call("setAttr", imageId(this), "alt", domString(value));
    }
    get complete(): boolean {
      return imageInfo(this).complete;
    }
    get currentSrc(): string {
      return imageInfo(this).currentSrc;
    }
    get naturalWidth(): number {
      return imageInfo(this).naturalWidth;
    }
    get naturalHeight(): number {
      return imageInfo(this).naturalHeight;
    }
  }
  Object.defineProperty(HTMLImageElement.prototype, Symbol.toStringTag, {
    value: "HTMLImageElement",
    configurable: true,
  });
  function Image(...dimensions: unknown[]): HTMLImageElement {
    if (!new.target) throw new TypeError("Image requires new");
    const image = new HTMLImageElement(internal, call<number>("create", idOf(document), "img"));
    if (dimensions.length > 0) image.setAttribute("width", String(idlNumber(dimensions[0]) >>> 0));
    if (dimensions.length > 1) image.setAttribute("height", String(idlNumber(dimensions[1]) >>> 0));
    return image;
  }
  Object.defineProperty(Image, "prototype", { value: HTMLImageElement.prototype, writable: false });
  const scripts = new WeakSet<object>();
  class HTMLScriptElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      scripts.add(this);
    }
    get src(): string {
      if (!scripts.has(this)) throw new TypeError("Illegal invocation");
      const value = call<string | null>("attr", idOf(this), "src");
      return linkValue("get", "href", value, documentBase()) ?? "";
    }
    set src(value: unknown) {
      if (!scripts.has(this)) throw new TypeError("Illegal invocation");
      call("setAttr", idOf(this), "src", usvString(value));
    }
  }
  Object.defineProperty(HTMLScriptElement.prototype, Symbol.toStringTag, {
    value: "HTMLScriptElement",
    configurable: true,
  });
  const mediaElements = new WeakSet<object>();
  function mediaId(owner: object): number {
    if (!mediaElements.has(owner)) throw new TypeError("Illegal invocation");
    return idOf(owner);
  }
  class HTMLMediaElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      mediaElements.add(this);
    }
    get src(): string {
      mediaId(this);
      const value = htmlAttribute(this, "src");
      return linkValue("get", "href", value, documentBase()) ?? "";
    }
    set src(value: unknown) {
      mediaId(this);
      reflectString(this, "src", usvString(value));
    }
  }
  for (const [property, attribute] of [
    ["autoplay", "autoplay"],
    ["loop", "loop"],
    ["controls", "controls"],
    ["defaultMuted", "muted"],
  ] as const) {
    Object.defineProperty(HTMLMediaElement.prototype, property, {
      get(this: HTMLMediaElement): boolean {
        mediaId(this);
        return hasHtmlAttribute(this, attribute);
      },
      set(this: HTMLMediaElement, value: unknown): void {
        mediaId(this);
        reflectBoolean(this, attribute, value);
      },
      enumerable: true,
      configurable: true,
    });
  }
  class HTMLAudioElement extends HTMLMediaElement {}
  const videoElements = new WeakSet<object>();
  function videoId(owner: object): number {
    if (!videoElements.has(owner)) throw new TypeError("Illegal invocation");
    return idOf(owner);
  }
  class HTMLVideoElement extends HTMLMediaElement {
    constructor(key?: symbol, id?: number) {
      super(key, id);
      videoElements.add(this);
    }
    get poster(): string {
      videoId(this);
      const value = htmlAttribute(this, "poster");
      return linkValue("get", "href", value, documentBase()) ?? "";
    }
    set poster(value: unknown) {
      videoId(this);
      reflectString(this, "poster", usvString(value));
    }
  }
  for (const attribute of ["width", "height"]) {
    Object.defineProperty(HTMLVideoElement.prototype, attribute, {
      get(this: HTMLVideoElement): number {
        videoId(this);
        const value = (htmlAttribute(this, attribute) ?? "").replace(/^[\t\n\f\r ]+/u, "");
        const number = Number.parseInt(value, 10);
        if (!/^\+?\d/u.test(value) || !Number.isFinite(number) || number > 2147483647) return 0;
        return number;
      },
      set(this: HTMLVideoElement, value: unknown): void {
        videoId(this);
        const number = idlNumber(value) >>> 0;
        if (number > 2147483647) {
          reflectString(this, attribute, "0");
          return;
        }
        reflectString(this, attribute, String(number));
      },
      enumerable: true,
      configurable: true,
    });
  }
  const bodyElements = new WeakSet<object>();
  function bodyId(owner: object): number {
    if (!bodyElements.has(owner)) throw new TypeError("Illegal invocation");
    return idOf(owner);
  }
  class HTMLBodyElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      bodyElements.add(this);
    }
    get background(): string {
      bodyId(this);
      return htmlAttribute(this, "background") ?? "";
    }
    set background(value: unknown) {
      bodyId(this);
      reflectString(this, "background", value);
    }
  }
  for (const [property, attribute] of [
    ["text", "text"],
    ["link", "link"],
    ["vLink", "vlink"],
    ["aLink", "alink"],
    ["bgColor", "bgcolor"],
  ] as const) {
    Object.defineProperty(HTMLBodyElement.prototype, property, {
      get(this: HTMLBodyElement): string {
        bodyId(this);
        return htmlAttribute(this, attribute) ?? "";
      },
      set(this: HTMLBodyElement, value: unknown): void {
        bodyId(this);
        reflectString(this, attribute, value === null ? "" : value);
      },
      enumerable: true,
      configurable: true,
    });
  }
  const framesetElements = new WeakSet<object>();
  function framesetId(owner: object): number {
    if (!framesetElements.has(owner)) throw new TypeError("Illegal invocation");
    return idOf(owner);
  }
  class HTMLFrameSetElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      framesetElements.add(this);
    }
  }
  for (const attribute of ["cols", "rows"]) {
    Object.defineProperty(HTMLFrameSetElement.prototype, attribute, {
      get(this: HTMLFrameSetElement): string {
        framesetId(this);
        return htmlAttribute(this, attribute) ?? "";
      },
      set(this: HTMLFrameSetElement, value: unknown): void {
        framesetId(this);
        reflectString(this, attribute, value);
      },
      enumerable: true,
      configurable: true,
    });
  }
  const frameElements = new WeakSet<object>();
  function frameId(owner: object): number {
    if (!frameElements.has(owner)) throw new TypeError("Illegal invocation");
    return idOf(owner);
  }
  class HTMLFrameElement extends HTMLElement {
    constructor(key?: symbol, id?: number) {
      if (key !== internal || id === undefined) throw new TypeError("Illegal constructor");
      super(internal, id);
      frameElements.add(this);
    }
    get noResize(): boolean {
      frameId(this);
      return hasHtmlAttribute(this, "noresize");
    }
    set noResize(value: unknown) {
      frameId(this);
      reflectBoolean(this, "noresize", value);
    }
    get contentWindow(): null {
      if (call<boolean>("get", frameId(this), "isConnected"))
        throw new DOMException(
          "Independent frame contexts are not implemented",
          "NotSupportedError",
        );
      return null;
    }
    get contentDocument(): null {
      frameId(this);
      return this.contentWindow;
    }
  }
  for (const [property, attribute, nullToEmpty] of [
    ["name", "name", false],
    ["scrolling", "scrolling", false],
    ["frameBorder", "frameborder", false],
    ["marginHeight", "marginheight", true],
    ["marginWidth", "marginwidth", true],
  ] as const) {
    Object.defineProperty(HTMLFrameElement.prototype, property, {
      get(this: HTMLFrameElement): string {
        frameId(this);
        return htmlAttribute(this, attribute) ?? "";
      },
      set(this: HTMLFrameElement, value: unknown): void {
        frameId(this);
        reflectString(this, attribute, nullToEmpty && value === null ? "" : value);
      },
      enumerable: true,
      configurable: true,
    });
  }
  for (const [property, attribute] of [
    ["src", "src"],
    ["longDesc", "longdesc"],
  ] as const) {
    Object.defineProperty(HTMLFrameElement.prototype, property, {
      get(this: HTMLFrameElement): string {
        frameId(this);
        const value = htmlAttribute(this, attribute);
        return linkValue("get", "href", value, documentBase()) ?? "";
      },
      set(this: HTMLFrameElement, value: unknown): void {
        frameId(this);
        reflectString(this, attribute, usvString(value));
      },
      enumerable: true,
      configurable: true,
    });
  }
  for (const constructor of [
    HTMLMediaElement,
    HTMLAudioElement,
    HTMLVideoElement,
    HTMLBodyElement,
    HTMLFrameSetElement,
    HTMLFrameElement,
  ]) {
    Object.defineProperty(constructor.prototype, Symbol.toStringTag, {
      value: constructor.name,
      configurable: true,
    });
    for (const property of Object.getOwnPropertyNames(constructor.prototype)) {
      if (property === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, property);
      if (descriptor)
        Object.defineProperty(constructor.prototype, property, { ...descriptor, enumerable: true });
    }
  }
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
    disableShadow: boolean;
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
    if (raw<number>("get", root, "nodeType") === 2) return [];
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
  type MutationWire = {
    type: string;
    target: number;
    attributeName: string | null;
    attributeNamespace: string | null;
    oldValue: string | null;
    addedNodes: number[];
    removedNodes: number[];
    previousSibling: number | null;
    nextSibling: number | null;
  };
  type MutationData = { wire: MutationWire; added: NodeList; removed: NodeList };
  const mutationData = new WeakMap<MutationRecord, MutationData>();
  function mutationRecordState(record: MutationRecord): MutationData {
    const state = mutationData.get(record);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  class MutationRecord {
    constructor(key?: symbol, wire?: MutationWire) {
      if (key !== internal || !wire) throw new TypeError("Illegal constructor");
      mutationData.set(this, {
        wire,
        added: makeCollection(new NodeList(internal), () => wire.addedNodes, "nodes"),
        removed: makeCollection(new NodeList(internal), () => wire.removedNodes, "nodes"),
      });
    }
    get type(): string {
      return mutationRecordState(this).wire.type;
    }
    get target(): Node {
      return node(mutationRecordState(this).wire.target);
    }
    get addedNodes(): NodeList {
      return mutationRecordState(this).added;
    }
    get removedNodes(): NodeList {
      return mutationRecordState(this).removed;
    }
    get previousSibling(): Node | null {
      const id = mutationRecordState(this).wire.previousSibling;
      return id === null ? null : node(id);
    }
    get nextSibling(): Node | null {
      const id = mutationRecordState(this).wire.nextSibling;
      return id === null ? null : node(id);
    }
    get attributeName(): string | null {
      return mutationRecordState(this).wire.attributeName;
    }
    get attributeNamespace(): string | null {
      return mutationRecordState(this).wire.attributeNamespace;
    }
    get oldValue(): string | null {
      return mutationRecordState(this).wire.oldValue;
    }
  }
  type MutationCallback = (
    this: MutationObserver,
    records: MutationRecord[],
    observer: MutationObserver,
  ) => void;
  type MutationState = { id: number; callback: MutationCallback };
  const mutationStates = new WeakMap<MutationObserver, MutationState>();
  const mutationObservers = new Map<number, MutationObserver>();
  let nextMutationObserver = 1;
  function mutationState(observer: MutationObserver): MutationState {
    const state = mutationStates.get(observer);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  function mutationRecords(id: number, operation: string): MutationRecord[] {
    return raw<MutationWire[]>("mutation", id, operation).map(
      (wire) => new MutationRecord(internal, wire),
    );
  }
  type MutationOptions = {
    attributeFilter?: unknown;
    attributeOldValue?: unknown;
    attributes?: unknown;
    characterData?: unknown;
    characterDataOldValue?: unknown;
    childList?: unknown;
    subtree?: unknown;
  };
  class MutationObserver {
    constructor(callback: MutationCallback) {
      if (typeof callback !== "function") throw new TypeError("callback must be callable");
      const id = nextMutationObserver++;
      raw<null>("mutation", id, "new");
      mutationStates.set(this, { id, callback });
      mutationObservers.set(id, this);
    }
    observe(target: Node, options: MutationOptions = {}): void {
      const { id } = mutationState(this);
      const handle = idOf(target);
      if (options !== null && typeof options !== "object" && typeof options !== "function")
        throw new TypeError("options must be a dictionary");
      const filterValue = options?.attributeFilter;
      const attributeFilter = filterValue === undefined ? null : stringSequence(filterValue);
      const oldAttributes = options?.attributeOldValue;
      const attributesValue = options?.attributes;
      const characterDataValue = options?.characterData;
      const oldCharacters = options?.characterDataOldValue;
      const childList = Boolean(options?.childList);
      const subtree = Boolean(options?.subtree);
      const attributes =
        attributesValue === undefined
          ? oldAttributes !== undefined || attributeFilter !== null
          : Boolean(attributesValue);
      const characterData =
        characterDataValue === undefined
          ? oldCharacters !== undefined
          : Boolean(characterDataValue);
      const attributeOldValue = Boolean(oldAttributes);
      const characterDataOldValue = Boolean(oldCharacters);
      if (
        (!attributes && (attributeOldValue || attributeFilter !== null)) ||
        (!characterData && characterDataOldValue) ||
        !(attributes || characterData || childList)
      )
        throw new TypeError("invalid mutation observation options");
      raw<null>(
        "mutation",
        id,
        "observe",
        JSON.stringify([
          handle,
          {
            attributes,
            characterData,
            childList,
            subtree,
            attributeOldValue,
            characterDataOldValue,
            attributeFilter,
          },
        ]),
      );
    }
    disconnect(): void {
      raw<null>("mutation", mutationState(this).id, "disconnect");
    }
    takeRecords(): MutationRecord[] {
      return mutationRecords(mutationState(this).id, "take");
    }
  }
  for (const [prototype, tag] of [
    [MutationRecord.prototype, "MutationRecord"],
    [MutationObserver.prototype, "MutationObserver"],
  ] as const) {
    Object.defineProperty(prototype, Symbol.toStringTag, { value: tag, configurable: true });
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key === "constructor") continue;
      Object.defineProperty(prototype, key, {
        ...Object.getOwnPropertyDescriptor(prototype, key),
        enumerable: true,
      });
    }
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
  function upgradeSubtree(root: Node): void {
    const id = idOf(root);
    reactions(() => {
      for (const target of customTree(id)) enqueue(target, () => upgrade(target));
    });
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
      if (definitions.size >= 1024) failLimit("custom element definition limit");
      defining = true;
      let prototype: object;
      const callbacks = new Map<string, CustomCallback>();
      let observed: string[];
      let disableShadow: boolean;
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
        disableShadow = stringSequence(Reflect.get(constructor, "disabledFeatures")).includes(
          "shadow",
        );
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
        disableShadow,
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
        if (pendingDefinitions.size >= 1024) failLimit("when-defined promise limit");
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
      upgradeSubtree(root);
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
      !(
        (operation === "selection" && arg === "setLength") ||
        [
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
    )
      return raw<T>(operation, id, arg, value);
    const mutate = () => {
      if (operation === "selection") {
        const before = customTree(id, false).filter(
          (target) =>
            raw<boolean>("get", idOf(target), "isConnected") &&
            customStates.get(target)?.status === "custom",
        );
        const result = raw<T>(operation, id, arg, value);
        for (const target of before)
          if (!raw<boolean>("get", idOf(target), "isConnected"))
            customCallback(target, "disconnectedCallback");
        return result;
      }
      if (operation === "style") {
        const target = nodes.get(id);
        const old = raw<string | null>("attrNS", id, JSON.stringify(["", "style"]));
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
        const old = raw<[string, string | null, string] | null>("attrInfo", id, arg);
        const result = raw<T>(operation, id, arg, value);
        const next =
          operation === "setAttr"
            ? raw<[string, string | null, string] | null>("attrInfo", id, arg)
            : null;
        const attribute = next ?? old;
        if (target && isHTML(target) && attribute)
          customCallback(target, "attributeChangedCallback", [
            attribute[0],
            old?.[2] ?? null,
            next?.[2] ?? null,
            attribute[1],
          ]);
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
      const previousDocuments = new Map(before.map((target) => [target, target.ownerDocument]));
      const result = raw<T>(operation, id, arg, value);
      for (const target of connected) customCallback(target, "disconnectedCallback");
      const after = replacedContents ? customTree(id, false) : before;
      for (const target of after) {
        if (customStates.get(target)?.status === "custom") {
          const previousDocument = previousDocuments.get(target);
          if (previousDocument && previousDocument !== target.ownerDocument)
            customCallback(target, "adoptedCallback", [previousDocument, target.ownerDocument]);
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
    get name(): string {
      if (!(this instanceof DocumentType)) throw new TypeError("Illegal invocation");
      return this.nodeName;
    }
    get publicId(): string {
      if (!(this instanceof DocumentType)) throw new TypeError("Illegal invocation");
      return call("get", idOf(this), "publicId");
    }
    get systemId(): string {
      if (!(this instanceof DocumentType)) throw new TypeError("Illegal invocation");
      return call("get", idOf(this), "systemId");
    }
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
    get assignedSlot(): HTMLSlotElement | null {
      idOf(this);
      return assignedSlot(this);
    }
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
          if (name === "audio") return new HTMLAudioElement(internal, id);
          if (name === "video") return new HTMLVideoElement(internal, id);
          if (name === "body") return new HTMLBodyElement(internal, id);
          if (name === "frameset") return new HTMLFrameSetElement(internal, id);
          if (name === "frame") return new HTMLFrameElement(internal, id);
          if (name === "iframe") return new HTMLIFrameElement(internal, id);
          if (name === "script") return new HTMLScriptElement(internal, id);
          if (name === "img") return new HTMLImageElement(internal, id);
          if (name === "slot") return new HTMLSlotElement(internal, id);
          if (name === "input") return new HTMLInputElement(internal, id);
          if (name === "form") return new HTMLFormElement(internal, id);
          if (name === "button") return new HTMLButtonElement(internal, id);
          if (name === "option") return new HTMLOptionElement(internal, id);
          if (name === "select") return new HTMLSelectElement(internal, id);
          if (name === "optgroup") return new HTMLOptGroupElement(internal, id);
          if (name === "textarea") return new HTMLTextAreaElement(internal, id);
          return new HTMLElement(internal, id);
        }
        return namespace === "http://www.w3.org/2000/svg"
          ? new SVGElement(internal, id)
          : new Element(internal, id);
      }
      case 2:
        return new Attr(internal, id);
      case 3:
        return new Text("", internal, id);
      case 8:
        return new Comment("", internal, id);
      case 9:
        return call<boolean>("get", id, "htmlDocument")
          ? new Document(internal, id)
          : new XMLDocument(internal, id);
      case 10:
        return new DocumentType(internal, id);
      case 11:
        if (raw("shadowInfo", id) !== null) return new ShadowRoot(internal, id);
        return new DocumentFragment(internal, id);
      default:
        return new Node(internal, id);
    }
  }

  class DocumentFragment extends ParentNode {
    getElementById(value: unknown): Element | null {
      if (!(this instanceof DocumentFragment)) throw new TypeError("Illegal invocation");
      if (arguments.length === 0) throw new TypeError("id is required");
      const id = domString(value);
      const result = call<number | null>("elementById", idOf(this), id);
      return result === null ? null : element(result);
    }
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
  function shadowState(root: object): [number, string] {
    const info = raw<[number, string] | null>("shadowInfo", idOf(root));
    if (!info) throw new TypeError("Illegal invocation");
    return info;
  }
  function assignedSlot(target: Node): HTMLSlotElement | null {
    const id = idOf(target);
    const slot = shadowRoots.size === 0 ? null : raw<number | null>("assignedSlot", id, "open");
    if (slot === null) return null;
    const result = node(slot);
    if (!(result instanceof HTMLSlotElement)) throw new TypeError("Expected HTMLSlotElement");
    return result;
  }
  function slotId(target: object): number {
    const id = attributeElement(target);
    if (
      raw<string>("get", id, "localName") !== "slot" ||
      raw<string>("get", id, "namespaceURI") !== "http://www.w3.org/1999/xhtml"
    )
      throw new TypeError("Illegal invocation");
    return id;
  }
  class HTMLSlotElement extends HTMLElement {
    get name(): string {
      return raw<string | null>("attrNS", slotId(this), JSON.stringify(["", "name"])) ?? "";
    }
    set name(value: unknown) {
      slotId(this);
      this.setAttributeNS(null, "name", domString(value));
    }
    assignedNodes(options: { flatten?: unknown } | null = {}): Node[] {
      const id = slotId(this);
      return raw<number[]>("slotNodes", id, options?.flatten ? "flatten" : "").map(node);
    }
    assignedElements(options: { flatten?: unknown } | null = {}): Element[] {
      return raw<number[]>("slotNodes", slotId(this), options?.flatten ? "flatten" : "")
        .filter((id) => raw<number>("get", id, "nodeType") === 1)
        .map(element);
    }
    assign(): never {
      slotId(this);
      throw new DOMException("manual slot assignment is not implemented", "NotSupportedError");
    }
  }
  Object.defineProperty(HTMLSlotElement.prototype, Symbol.toStringTag, {
    value: "HTMLSlotElement",
    configurable: true,
  });
  class ShadowRoot extends DocumentFragment {
    constructor(key: symbol, id: number) {
      if (key !== internal) throw new TypeError("Illegal constructor");
      super(internal, id);
      shadowRoots.add(id);
    }
    get host(): Element {
      return element(shadowState(this)[0]);
    }
    get mode(): string {
      return shadowState(this)[1];
    }
    get delegatesFocus(): boolean {
      shadowState(this);
      return false;
    }
    get clonable(): boolean {
      shadowState(this);
      return false;
    }
    get serializable(): boolean {
      shadowState(this);
      return false;
    }
    get slotAssignment(): string {
      shadowState(this);
      return "named";
    }
    get customElementRegistry(): CustomElementRegistry {
      shadowState(this);
      return customElements;
    }
    get innerHTML(): string {
      shadowState(this);
      return call("get", idOf(this), "innerHTML");
    }
    set innerHTML(value: unknown) {
      shadowState(this);
      call("set", idOf(this), "innerHTML", value === null ? "" : domString(value));
    }
    get adoptedStyleSheets(): never {
      shadowState(this);
      throw new DOMException("shadow stylesheets are not implemented", "NotSupportedError");
    }
    set adoptedStyleSheets(_value: unknown) {
      shadowState(this);
      throw new DOMException("shadow stylesheets are not implemented", "NotSupportedError");
    }
    get styleSheets(): never {
      shadowState(this);
      throw new DOMException("shadow stylesheets are not implemented", "NotSupportedError");
    }
  }
  Object.defineProperty(ShadowRoot.prototype, Symbol.toStringTag, {
    value: "ShadowRoot",
    configurable: true,
  });
  for (const key of [
    "host",
    "mode",
    "delegatesFocus",
    "clonable",
    "serializable",
    "slotAssignment",
    "customElementRegistry",
    "innerHTML",
    "adoptedStyleSheets",
    "styleSheets",
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, key);
    if (descriptor)
      Object.defineProperty(ShadowRoot.prototype, key, { ...descriptor, enumerable: true });
  }
  type HandlerEntry = { value: object; listener: Listener };
  const handlerEntries = new WeakMap<object, Map<string, HandlerEntry>>();
  // Internal handler registration must not call page-overridden listener methods.
  // oxlint-disable-next-line typescript/unbound-method
  const addHandlerListener = EventTarget.prototype.addEventListener;
  // oxlint-disable-next-line typescript/unbound-method
  const removeHandlerListener = EventTarget.prototype.removeEventListener;
  function defineEventHandlers(
    prototype: object,
    guard: (target: Target) => void,
    types: readonly string[],
  ): void {
    for (const type of types) {
      const get = function (this: Target): object | null {
        guard(this);
        return handlerEntries.get(this)?.get(type)?.value ?? null;
      };
      const set = function (this: Target, value: unknown) {
        guard(this);
        const entries = handlerEntries.get(this) ?? new Map<string, HandlerEntry>();
        const entry = entries.get(type);
        if (value === null || (typeof value !== "object" && typeof value !== "function")) {
          if (entry) removeHandlerListener.call(this, type, entry.listener);
          entries.delete(type);
          return;
        }
        if (entry) {
          entry.value = value;
          return;
        }
        const listener = (event: Event): void => {
          const callback = entries.get(type)?.value;
          if (typeof callback !== "function") return;
          const result: unknown = callback.call(this, event);
          const state = eventState(event);
          if (result === false && state.cancelable && !state.passive) state.canceled = true;
        };
        entries.set(type, { value, listener });
        handlerEntries.set(this, entries);
        addHandlerListener.call(this, type, listener);
      };
      for (const [kind, accessor] of [
        ["get", get],
        ["set", set],
      ] as const)
        Object.defineProperty(accessor, "name", { value: `${kind} on${type}`, configurable: true });
      Object.defineProperty(prototype, "on" + type, {
        get,
        set,
        enumerable: true,
        configurable: true,
      });
    }
  }
  defineEventHandlers(
    ShadowRoot.prototype,
    (target) => {
      shadowState(target);
    },
    ["slotchange"],
  );
  defineEventHandlers(
    HTMLSlotElement.prototype,
    (target) => {
      slotId(target);
    },
    ["slotchange"],
  );
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
  const implementations = new WeakMap<Document, DOMImplementation>();
  const implementationDocuments = new WeakMap<DOMImplementation, Document>();
  class DOMImplementation {
    constructor(key: symbol, owner: Document) {
      if (key !== internal) throw new TypeError("Illegal constructor");
      implementationDocuments.set(this, owner);
    }
    hasFeature(): boolean {
      if (!implementationDocuments.has(this)) throw new TypeError("Illegal invocation");
      return true;
    }
    createHTMLDocument(title?: unknown): Document {
      const owner = implementationDocuments.get(this);
      if (!owner) throw new TypeError("Illegal invocation");
      const text = title === undefined ? null : domString(title);
      return documentNode(raw("newHTMLDocument", idOf(owner), "", JSON.stringify(text)));
    }
    createDocument(
      namespace: unknown,
      qualifiedName: unknown,
      doctype: DocumentType | null = null,
    ): XMLDocument {
      const owner = implementationDocuments.get(this);
      if (!owner) throw new TypeError("Illegal invocation");
      required(2, arguments.length);
      if (doctype !== null && !(doctype instanceof DocumentType))
        throw new TypeError("Expected DocumentType");
      if (doctype !== null)
        throw new DOMException("DocumentType transfer is not implemented", "NotSupportedError");
      const id = raw<number>(
        "newDocument",
        idOf(owner),
        "",
        JSON.stringify([
          attributeNamespace(namespace),
          domString(qualifiedName === null ? "" : qualifiedName),
        ]),
      );
      const result = node(id);
      if (!(result instanceof XMLDocument)) throw new TypeError("Expected native XMLDocument");
      return result;
    }
  }
  function documentNode(id: number): Document {
    const result = node(id);
    if (!(result instanceof Document)) throw new TypeError("Expected native Document");
    return result;
  }
  class Document extends ParentNode {
    declare readonly location: typeof browserLocation | null;
    constructor(key: symbol, id: number) {
      super(key, id);
      Object.defineProperty(this, "location", {
        enumerable: true,
        configurable: false,
        get(this: Document) {
          if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
          idOf(this);
          return this === document ? browserLocation : null;
        },
        set(this: Document, _value: unknown) {
          if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
          idOf(this);
          if (this !== document) throw new TypeError("Document has no browsing context");
          throw new DOMException("Document navigation is not implemented", "NotSupportedError");
        },
      });
    }
    get currentScript(): Element | null {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      const id = call<number | null>("get", idOf(this), "currentScript");
      return id === null ? null : element(id);
    }
    get doctype(): DocumentType | null {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      for (const child of this.childNodes) if (child instanceof DocumentType) return child;
      return null;
    }
    get implementation(): DOMImplementation {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      let result = implementations.get(this);
      if (!result) {
        result = new DOMImplementation(internal, this);
        implementations.set(this, result);
      }
      return result;
    }
    get contentType(): string {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      return raw("get", idOf(this), "contentType");
    }
    get defaultView(): typeof globalThis | null {
      idOf(this);
      return this === document ? globalThis : null;
    }
    createAttribute(name: unknown): Attr {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      required(1, arguments.length);
      return attributeNode(raw("attributeNode", idOf(this), "new", domString(name)));
    }
    createAttributeNS(namespace: unknown, qualifiedName: unknown): Attr {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      required(2, arguments.length);
      return attributeNode(
        raw(
          "attributeNode",
          idOf(this),
          "newNS",
          JSON.stringify([attributeNamespace(namespace), domString(qualifiedName)]),
        ),
      );
    }
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
    get documentElement(): Element | null {
      return this.children.item(0);
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
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      required(1, arguments.length);
      return node(raw("createText", idOf(this), "", domString(data)));
    }
    createComment(data: string) {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      required(1, arguments.length);
      return node(raw("createComment", idOf(this), "", domString(data)));
    }
    createDocumentFragment() {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      return node(raw("createFragment", idOf(this)));
    }
    createElementNS(namespace: unknown, qualifiedName: unknown) {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      if (arguments.length < 2) throw new TypeError("createElementNS requires namespace and name");
      const uri = namespace === null || namespace === undefined ? "" : domString(namespace);
      const name = domString(qualifiedName);
      return createdElement(() => call<number>("createNS", idOf(this), name, uri));
    }
    createElement(tag: string) {
      if (!(this instanceof Document)) throw new TypeError("Illegal invocation");
      if (arguments.length === 0) throw new TypeError("createElement requires a name");
      const localName = domString(tag);
      return createdElement(() => call<number>("create", idOf(this), localName));
    }
  }
  class XMLDocument extends Document {}
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
  for (const [prototype, keys] of [
    [Node.prototype, ["getRootNode", "hasChildNodes", "cloneNode"]],
    [
      Element.prototype,
      [
        "attachShadow",
        "shadowRoot",
        "assignedSlot",
        "slot",
        "firstElementChild",
        "lastElementChild",
      ],
    ],
    [Text.prototype, ["assignedSlot"]],
    [DocumentFragment.prototype, ["getElementById", "firstElementChild", "lastElementChild"]],
    [Document.prototype, ["firstElementChild", "lastElementChild", "currentScript"]],
    [HTMLScriptElement.prototype, ["src"]],
    [DocumentType.prototype, ["name", "publicId", "systemId"]],
    [DOMImplementation.prototype, ["createHTMLDocument", "hasFeature"]],
    [HTMLSlotElement.prototype, ["name", "assignedNodes", "assignedElements", "assign"]],
  ] as const) {
    for (const key of keys) {
      const descriptor =
        Object.getOwnPropertyDescriptor(prototype, key) ??
        Object.getOwnPropertyDescriptor(ParentNode.prototype, key);
      if (descriptor) Object.defineProperty(prototype, key, { ...descriptor, enumerable: true });
    }
  }
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
      failLimit("animation frame capacity limit");
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
      if (timerTasks >= timerTaskLimit) failLimit("timer task limit");
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
    if (timers.size + animationFrames.size >= timerLimit) failLimit("timer capacity limit");
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
  function nextTimerDelay(): number | null {
    let due = Number.POSITIVE_INFINITY;
    for (const task of timers.values()) if (task.due < due) due = task.due;
    if (animationFrames.size > 0 && frameDue < due) due = frameDue;
    if (!Number.isFinite(due)) return null;
    return Math.max(0, due - now());
  }
  function timer(run: boolean, peek = false): number | null {
    // Peek reports the next wake without resetting nesting or running a callback.
    if (peek) return nextTimerDelay();
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
    if (timerTasks >= timerTaskLimit) failLimit("timer task limit");
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
    const number = idlNumber(value);
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
          if (thresholds.length >= intersectionLimit) failLimit("intersection threshold limit");
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
        failLimit("intersection registration limit");
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
    if (timerTasks >= timerTaskLimit) failLimit("timer task limit");
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

  const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
  const headerValue = /^[^\0\r\n]*$/;
  // Request headers the page cannot set; browsers drop them silently.
  const forbiddenHeaders = new Set([
    "accept-charset",
    "accept-encoding",
    "access-control-request-headers",
    "access-control-request-method",
    "connection",
    "content-length",
    "cookie",
    "cookie2",
    "date",
    "dnt",
    "expect",
    "host",
    "keep-alive",
    "origin",
    "referer",
    "set-cookie",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "via",
  ]);
  const headerLists = new WeakMap<object, [string, string][]>();
  function headerList(value: object): [string, string][] {
    const list = headerLists.get(value);
    if (!list) throw new TypeError("Illegal Headers invocation");
    return list;
  }
  function normalizeHeader(name: unknown, value: unknown): [string, string] {
    const key = String(name).toLowerCase();
    const text = String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
    if (!headerName.test(key) || !headerValue.test(text))
      throw new TypeError(`invalid header: ${key}`);
    return [key, text];
  }
  const iteratorKey = Symbol.iterator;
  const headerPairs = (value: object): value is Iterable<unknown> => iteratorKey in value;
  class Headers {
    constructor(init?: unknown) {
      headerLists.set(this, []);
      if (init === undefined || init === null) return;
      if (init instanceof Headers) {
        for (const [name, value] of headerList(init)) this.append(name, value);
      } else if (typeof init === "object" && headerPairs(init)) {
        for (const pair of init) {
          if (!Array.isArray(pair) || pair.length !== 2)
            throw new TypeError("header pairs must have two items");
          this.append(pair[0], pair[1]);
        }
      } else if (typeof init === "object") {
        for (const [name, value] of Object.entries(init)) this.append(name, value);
      } else throw new TypeError("invalid headers init");
    }
    append(name: unknown, value: unknown): void {
      headerList(this).push(normalizeHeader(name, value));
    }
    set(name: unknown, value: unknown): void {
      const pair = normalizeHeader(name, value);
      const list = headerList(this).filter(([key]) => key !== pair[0]);
      list.push(pair);
      headerLists.set(this, list);
    }
    delete(name: unknown): void {
      const key = String(name).toLowerCase();
      headerLists.set(
        this,
        headerList(this).filter(([item]) => item !== key),
      );
    }
    get(name: unknown): string | null {
      const key = String(name).toLowerCase();
      const values = headerList(this)
        .filter(([item]) => item === key)
        .map(([, value]) => value);
      return values.length === 0 ? null : values.join(", ");
    }
    has(name: unknown): boolean {
      const key = String(name).toLowerCase();
      return headerList(this).some(([item]) => item === key);
    }
    getSetCookie(): string[] {
      return headerList(this)
        .filter(([key]) => key === "set-cookie")
        .map(([, value]) => value);
    }
    *entries(): IterableIterator<[string, string]> {
      const names = [...new Set(headerList(this).map(([key]) => key))].toSorted();
      for (const name of names) yield [name, this.get(name) ?? ""];
    }
    *keys(): IterableIterator<string> {
      for (const [name] of this.entries()) yield name;
    }
    *values(): IterableIterator<string> {
      for (const [, value] of this.entries()) yield value;
    }
    forEach(callback: (value: string, name: string, headers: Headers) => void, self?: unknown) {
      for (const [name, value] of this.entries()) callback.call(self, value, name, this);
    }
    [Symbol.iterator](): IterableIterator<[string, string]> {
      return this.entries();
    }
  }
  Object.defineProperty(Headers.prototype, Symbol.toStringTag, {
    value: "Headers",
    configurable: true,
  });

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
    get headers(): Headers {
      return new Headers(responseState(this).headers);
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
  type FetchInit = {
    method?: string;
    body?: string;
    headers?: unknown;
    credentials?: string;
    redirect?: string;
  };
  const fetch = async (url: string, options: FetchInit = {}) => {
    for (const key of Object.keys(options)) {
      if (!["method", "body", "headers", "credentials", "redirect"].includes(key))
        throw new TypeError(`unsupported fetch option: ${key}`);
    }
    const method = (options.method ?? "GET").toUpperCase();
    if (method === "GET" && options.body !== undefined)
      throw new TypeError("GET cannot have a body");
    // Requests are same-origin, so "same-origin" and "include" both send cookies.
    if (![undefined, "same-origin", "include"].includes(options.credentials))
      throw new TypeError(`unsupported fetch credentials: ${options.credentials}`);
    if (![undefined, "follow", "error"].includes(options.redirect))
      throw new TypeError(`unsupported fetch redirect: ${options.redirect}`);
    const headers = [...new Headers(options.headers)].filter(
      ([name]) => !forbiddenHeaders.has(name) && !/^(proxy|sec)-/.test(name),
    );
    if (headers.length > 64) throw new TypeError("fetch header limit");
    let state: Awaited<ReturnType<typeof nativeRequest>>;
    try {
      state = await nativeRequest(
        url,
        method,
        options.body ?? "",
        headers,
        options.redirect === "error",
      );
    } catch (error) {
      // Fetch reports network and policy failures as TypeError; keep the host detail.
      throw new TypeError(error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    }
    return new Response(responseKey, state);
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
    resource: number;
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
    if (length > 1_048_576) failLimit("font data limit");
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
        const response = await nativeRequest(url, "GET", "", [], false);
        if (response.status < 200 || response.status >= 300 || response.body === null) continue;
        const data = fontBytes(response.body);
        const fontId = nativeFontData(data);
        if (!fontId) continue;
        state.resource = fontId;
        fontsEverLoaded = true;
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
    {
      canvas: OffscreenCanvas;
      attributes: Record<string, unknown>;
      font: string;
      size: number;
      fonts: { font: string; size: number }[];
    }
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
    if (size > 4096) failLimit("canvas: dimensions limit");
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
          failLimit("canvas: pixels limit");
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
  function resetCanvasFont(canvas: OffscreenCanvas): void {
    const context = canvasOwner(canvas).context;
    if (!context) return;
    const drawing = drawingOwner(context);
    drawing.font = "10px sans-serif";
    drawing.size = 10;
    drawing.fonts.length = 0;
  }
  const textWidths = new WeakMap<object, number>();
  class TextMetrics {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
    get width(): number {
      const width = textWidths.get(this);
      if (width === undefined) throw new TypeError("Illegal TextMetrics invocation");
      return width;
    }
  }
  Object.defineProperty(TextMetrics.prototype, Symbol.toStringTag, {
    value: "TextMetrics",
    configurable: true,
  });
  for (const name of [
    "actualBoundingBoxLeft",
    "actualBoundingBoxRight",
    "actualBoundingBoxAscent",
    "actualBoundingBoxDescent",
    "fontBoundingBoxAscent",
    "fontBoundingBoxDescent",
    "emHeightAscent",
    "emHeightDescent",
    "hangingBaseline",
    "alphabeticBaseline",
    "ideographicBaseline",
  ])
    Object.defineProperty(TextMetrics.prototype, name, {
      get(this: object) {
        if (!textWidths.has(this)) throw new TypeError("Illegal TextMetrics invocation");
        throw new Error("unsupported: text bounding box metrics");
      },
      configurable: true,
    });
  class OffscreenCanvasRenderingContext2D {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
    get canvas(): OffscreenCanvas {
      return drawingOwner(this).canvas;
    }
    get font(): string {
      return drawingOwner(this).font;
    }
    set font(value: unknown) {
      const drawing = drawingOwner(this);
      const parsed: unknown = JSON.parse(nativeFontMeta("canvasFont", domString(value)));
      if (parsed === null) return;
      if (typeof parsed !== "object") throw new Error("Invalid native canvas font");
      const font: unknown = Reflect.get(parsed, "font"),
        size: unknown = Reflect.get(parsed, "size");
      if (typeof font !== "string" || typeof size !== "number")
        throw new Error("Invalid native canvas font");
      drawing.font = font;
      drawing.size = size;
    }
    measureText(text: unknown): TextMetrics {
      const drawing = drawingOwner(this);
      if (arguments.length < 1) throw new TypeError("measureText requires text");
      const source = usvString(text).replace(/[\t\n\r\f]/g, " ");
      let width = 0;
      if (source.length > 0) {
        const faces = matchingFonts(documentFonts, drawing.font, source);
        if (faces.length !== 1) throw new Error("unsupported: font glyph fallback");
        const selected = faces[0];
        if (!selected) throw new Error("Invalid native font match");
        const face = fontState(selected);
        if (!face.resource || face.status !== "loaded")
          throw new Error("unsupported: unloaded font shaping");
        for (const name of [
          "style",
          "weight",
          "stretch",
          "variant",
          "featureSettings",
          "variationSettings",
          "sizeAdjust",
          "ascentOverride",
          "descentOverride",
          "lineGapOverride",
        ] as const)
          if (face.descriptors[name] !== fontDefaults[name])
            throw new Error("unsupported: font shaping descriptor " + name);
        // Width is native OpenType shaping, never a JavaScript glyph estimate.
        width = nativeFontMeasure(face.resource, source, drawing.size);
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const metrics = Object.create(TextMetrics.prototype) as TextMetrics;
      textWidths.set(metrics, width);
      return metrics;
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
      const drawing = drawingOwner(this);
      canvasCall("save", canvasOwner(drawing.canvas).id);
      drawing.fonts.push({ font: drawing.font, size: drawing.size });
    }
    restore(): void {
      const drawing = drawingOwner(this);
      canvasCall("restore", canvasOwner(drawing.canvas).id);
      const state = drawing.fonts.pop();
      if (state) {
        drawing.font = state.font;
        drawing.size = state.size;
      }
    }
    reset(): void {
      const drawing = drawingOwner(this);
      canvasCall("reset", canvasOwner(drawing.canvas).id);
      resetCanvasFont(drawing.canvas);
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
      resetCanvasFont(this);
    }
    get height(): number {
      return canvasCall<number[]>("size", canvasOwner(this).id)[1] ?? 0;
    }
    set height(value: unknown) {
      const id = canvasOwner(this).id;
      canvasCall("resize", id, { width: this.width, height: canvasDimension(value) });
      resetCanvasFont(this);
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
      const drawing = {
        canvas: this,
        attributes,
        font: "10px sans-serif",
        size: 10,
        fonts: [] as { font: string; size: number }[],
      };
      drawingOwners.set(target, drawing);
      const proxy = new Proxy(target, {
        set(object, key, value, receiver) {
          if (
            [
              "strokeStyle",
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
      drawingOwners.set(proxy, drawing);
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
        resource: 0,
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
        const resource = nativeFontData(data);
        if (resource) {
          state.resource = resource;
          fontsEverLoaded = true;
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
  function synchronizeLayoutFonts(): void {
    const registered = [...fontSetState(documentFonts).all].flatMap((face) => {
      const state = fontState(face);
      if (state.status !== "loaded" || !state.resource) return [];
      return [
        {
          resource: state.resource,
          supported: (
            [
              "variant",
              "featureSettings",
              "variationSettings",
              "sizeAdjust",
              "ascentOverride",
              "descentOverride",
              "lineGapOverride",
            ] as const
          ).every((name) => state.descriptors[name] === fontDefaults[name]),
          family: usvString(state.family),
          style: state.descriptors.style ?? "normal",
          weight: state.descriptors.weight ?? "normal",
          stretch: state.descriptors.stretch ?? "normal",
          range: state.descriptors.unicodeRange ?? "U+0-10FFFF",
        },
      ];
    });
    nativeDom("fontResources", 0, JSON.stringify(registered), "");
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
  const handlerTypes = [
    "click",
    "dblclick",
    "contextmenu",
    "mousedown",
    "mouseup",
    "mousemove",
    "mouseover",
    "mouseout",
    "mouseenter",
    "mouseleave",
    "pointerdown",
    "pointerup",
    "pointermove",
    "pointerover",
    "pointerout",
    "pointerenter",
    "pointerleave",
    "pointercancel",
    "gotpointercapture",
    "lostpointercapture",
    "input",
    "beforeinput",
    "change",
    "submit",
    "reset",
    "focus",
    "blur",
    "keydown",
    "keyup",
    "keypress",
    "load",
    "scroll",
    "scrollend",
  ];
  for (const prototype of [HTMLElement.prototype, SVGElement.prototype, Document.prototype])
    defineEventHandlers(
      prototype,
      (target) => {
        if (!prototype.isPrototypeOf(target)) throw new TypeError("Illegal invocation");
        idOf(target);
      },
      [...handlerTypes, "error"],
    );
  defineEventHandlers(
    globalThis,
    (target) => {
      if (target !== globalThis) throw new TypeError("Illegal invocation");
    },
    handlerTypes,
  );
  type StateValue =
    | null
    | boolean
    | number
    | string
    | { ref: number }
    | { atom: string; text?: string };
  type StateNode =
    | { kind: "object" | "array"; length: number; props: [string, StateValue][] }
    | { kind: "date"; time: StateValue }
    | { kind: "regexp"; source: string; flags: string }
    | { kind: "map"; entries: [StateValue, StateValue][] }
    | { kind: "set"; values: StateValue[] };
  type StatePacket = { root: StateValue; stateNodes: StateNode[] };
  const stateKeys = Object.keys;
  const stateStringify = JSON.stringify;
  const stateParse = JSON.parse;
  // Intrinsics are captured now and invoked later with an explicit branded receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const stateMapHas = Map.prototype.has;
  // Intrinsics are captured now and invoked later with an explicit branded receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const stateMapEntries = Map.prototype.entries;
  // Intrinsics are captured now and invoked later with an explicit branded receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const stateSetHas = Set.prototype.has;
  // Intrinsics are captured now and invoked later with an explicit branded receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const stateSetValues = Set.prototype.values;
  // Intrinsics are captured now and invoked later with an explicit branded receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const stateDateTime = Date.prototype.getTime;
  // Intrinsics are captured now and invoked later with an explicit branded receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const stateRegExpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")?.get;
  // Intrinsics are captured now and invoked later with an explicit branded receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const stateRegExpFlags = Object.getOwnPropertyDescriptor(RegExp.prototype, "flags")?.get;
  const StateDate = Date,
    StateMap = Map,
    StateSet = Set,
    StateRegExp = RegExp;
  function stateCloneError(): never {
    throw new DOMException("unsupported history state", "DataCloneError");
  }
  function stateBrand(value: object, check: (this: object, arg?: unknown) => unknown): boolean {
    try {
      check.call(value);
      return true;
    } catch {
      return false;
    }
  }
  function encodeHistoryState(input: unknown): string {
    const seen = new Map<object, number>();
    const objects: object[] = [];
    const stateNodes: StateNode[] = [];
    const encode = (value: unknown): StateValue => {
      if (value === null || typeof value === "boolean" || typeof value === "string") return value;
      if (typeof value === "number") {
        if (Number.isNaN(value)) return { atom: "nan" };
        if (value === Infinity) return { atom: "infinity" };
        if (value === -Infinity) return { atom: "negativeInfinity" };
        return Object.is(value, -0) ? { atom: "negativeZero" } : value;
      }
      if (typeof value === "undefined") return { atom: "undefined" };
      if (typeof value === "bigint") return { atom: "bigint", text: value.toString() };
      if (
        typeof value !== "object" ||
        nativeIsProxy(value) ||
        ids.has(value) ||
        targets.has(value) ||
        events.has(value) ||
        collections.has(value) ||
        urlStates.has(value)
      )
        return stateCloneError();
      const previous = seen.get(value);
      if (previous !== undefined) return { ref: previous };
      if (objects.length >= 256) return stateCloneError();
      const ref = objects.length;
      seen.set(value, ref);
      objects.push(value);
      return { ref };
    };
    const root = encode(input);
    for (const value of objects) {
      if (stateBrand(value, stateDateTime))
        stateNodes.push({ kind: "date", time: encode(stateDateTime.call(value)) });
      else if (stateBrand(value, stateMapHas)) {
        const entries: [StateValue, StateValue][] = [];
        const sourceEntries: Iterable<[unknown, unknown]> = stateMapEntries.call(value);
        for (const [key, item] of sourceEntries) entries.push([encode(key), encode(item)]);
        stateNodes.push({ kind: "map", entries });
      } else if (stateBrand(value, stateSetHas)) {
        const values: StateValue[] = [];
        for (const item of stateSetValues.call(value)) values.push(encode(item));
        stateNodes.push({ kind: "set", values });
      } else if (stateRegExpSource && stateRegExpFlags && stateBrand(value, stateRegExpSource)) {
        stateNodes.push({
          kind: "regexp",
          source: String(stateRegExpSource.call(value)),
          flags: String(stateRegExpFlags.call(value)),
        });
      } else {
        const prototype: unknown = Object.getPrototypeOf(value);
        if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
          return stateCloneError();
        const props: [string, StateValue][] = [];
        for (const key of stateKeys(value)) props.push([key, encode(Reflect.get(value, key))]);
        stateNodes.push({
          kind: Array.isArray(value) ? "array" : "object",
          length: Array.isArray(value) ? value.length : 0,
          props,
        });
      }
    }
    return stateStringify({ root, stateNodes });
  }
  function decodeHistoryState(wire: string): unknown {
    if (wire === "") return null;
    // The owned encoder produces this graph; Rust retains its opaque wire value.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const packet = stateParse(wire) as StatePacket;
    const objects: object[] = [];
    const decode = (value: StateValue): unknown => {
      if (value === null || typeof value !== "object") return value;
      if ("ref" in value) return objects[value.ref];
      switch (value.atom) {
        case "undefined":
          return undefined;
        case "nan":
          return NaN;
        case "infinity":
          return Infinity;
        case "negativeInfinity":
          return -Infinity;
        case "negativeZero":
          return -0;
        case "bigint":
          return BigInt(value.text ?? "0");
        default:
          throw new TypeError("invalid history state atom");
      }
    };
    for (const stateNode of packet.stateNodes) {
      switch (stateNode.kind) {
        case "object":
          objects.push({});
          break;
        case "array":
          const array: unknown[] = [];
          array.length = stateNode.length;
          objects.push(array);
          break;
        case "date":
          objects.push(new StateDate(Number(decode(stateNode.time))));
          break;
        case "regexp":
          objects.push(new StateRegExp(stateNode.source, stateNode.flags));
          break;
        case "map":
          objects.push(new StateMap<unknown, unknown>());
          break;
        case "set":
          objects.push(new StateSet<unknown>());
          break;
      }
    }
    packet.stateNodes.forEach((stateNode, index) => {
      const object = objects[index];
      if (!object) throw new TypeError("invalid history state object");
      if (stateNode.kind === "object" || stateNode.kind === "array")
        for (const [key, value] of stateNode.props)
          Object.defineProperty(object, key, {
            value: decode(value),
            writable: true,
            enumerable: true,
            configurable: true,
          });
      else if (stateNode.kind === "map" && object instanceof StateMap)
        for (const [key, value] of stateNode.entries) object.set(decode(key), decode(value));
      else if (stateNode.kind === "set" && object instanceof StateSet)
        for (const value of stateNode.values) object.add(decode(value));
    });
    return decode(packet.root);
  }
  type HistorySnapshot = { url: string; state: string; length: number };
  const historyBrands = new WeakSet<object>();
  const popStates = new WeakMap<object, unknown>();
  const hashChanges = new WeakMap<object, { oldURL: string; newURL: string }>();
  let currentHistoryState: unknown = null;
  let scrollRestoration = "auto";
  function historyBrand(value: object): void {
    if (!historyBrands.has(value)) throw new TypeError("Illegal invocation");
  }
  function applyHistory(snapshot: HistorySnapshot): void {
    href = snapshot.url;
    currentHistoryState = decodeHistoryState(snapshot.state);
  }
  class History {
    constructor(key?: symbol) {
      if (key !== internal) throw new TypeError("Illegal constructor");
      historyBrands.add(this);
    }
    get length(): number {
      historyBrand(this);
      return raw<number>("history", 0, "length");
    }
    get state(): unknown {
      historyBrand(this);
      return currentHistoryState;
    }
    get scrollRestoration(): string {
      historyBrand(this);
      return scrollRestoration;
    }
    set scrollRestoration(value: unknown) {
      historyBrand(this);
      const name = domString(value);
      if (name === "auto" || name === "manual") scrollRestoration = name;
    }
    pushState(data: unknown, unused: unknown, url: unknown = null): void {
      historyBrand(this);
      if (arguments.length < 2) throw new TypeError("pushState requires two arguments");
      domString(unused);
      const target = url === null || url === undefined ? null : domString(url);
      const state = encodeHistoryState(data);
      applyHistory(raw<HistorySnapshot>("history", 0, "push", stateStringify([state, target])));
    }
    replaceState(data: unknown, unused: unknown, url: unknown = null): void {
      historyBrand(this);
      if (arguments.length < 2) throw new TypeError("replaceState requires two arguments");
      domString(unused);
      const target = url === null || url === undefined ? null : domString(url);
      const state = encodeHistoryState(data);
      applyHistory(raw<HistorySnapshot>("history", 0, "replace", stateStringify([state, target])));
    }
    go(delta: unknown = 0): void {
      historyBrand(this);
      travelHistory(delta);
    }
    back(): void {
      historyBrand(this);
      travelHistory(-1);
    }
    forward(): void {
      historyBrand(this);
      travelHistory(1);
    }
  }
  function travelHistory(delta: unknown): void {
    const offset = idlNumber(delta) >> 0;
    if (offset === 0)
      throw new DOMException("history reload is not implemented", "NotSupportedError");
    setTimeout(() => {
      const previous = href;
      const snapshot = raw<HistorySnapshot | null>("history", 0, "travel", String(offset));
      if (!snapshot) return;
      applyHistory(snapshot);
      const next = href;
      const event = new PopStateEvent("popstate");
      popStates.set(event, currentHistoryState);
      dispatch(globalThis, event, true);
      if (
        linkValue("set", "hash", previous, "", "") === linkValue("set", "hash", next, "", "") &&
        linkValue("get", "hash", previous, "") !== linkValue("get", "hash", next, "")
      )
        setTimeout(
          () =>
            dispatch(
              globalThis,
              new HashChangeEvent("hashchange", { oldURL: previous, newURL: next }),
              true,
            ),
          0,
        );
    }, 0);
  }
  class PopStateEvent extends Event {
    constructor(type: unknown, init: (EventInit & { state?: unknown }) | null = {}) {
      if (arguments.length === 0) throw new TypeError("PopStateEvent requires a type");
      super(type, init);
      popStates.set(this, init?.state ?? null);
    }
    get state(): unknown {
      if (!popStates.has(this)) throw new TypeError("Illegal invocation");
      return popStates.get(this);
    }
  }
  class HashChangeEvent extends Event {
    constructor(
      type: unknown,
      init: (EventInit & { oldURL?: unknown; newURL?: unknown }) | null = {},
    ) {
      if (arguments.length === 0) throw new TypeError("HashChangeEvent requires a type");
      super(type, init);
      hashChanges.set(this, {
        oldURL: domString(init?.oldURL === undefined ? "" : init.oldURL),
        newURL: domString(init?.newURL === undefined ? "" : init.newURL),
      });
    }
    get oldURL(): string {
      const data = hashChanges.get(this);
      if (!data) throw new TypeError("Illegal invocation");
      return data.oldURL;
    }
    get newURL(): string {
      const data = hashChanges.get(this);
      if (!data) throw new TypeError("Illegal invocation");
      return data.newURL;
    }
  }
  for (const [prototype, tag] of [
    [History.prototype, "History"],
    [PopStateEvent.prototype, "PopStateEvent"],
    [HashChangeEvent.prototype, "HashChangeEvent"],
  ] as const) {
    Object.defineProperty(prototype, Symbol.toStringTag, { value: tag, configurable: true });
    for (const key of Object.getOwnPropertyNames(prototype))
      if (key !== "constructor")
        Object.defineProperty(prototype, key, {
          ...Object.getOwnPropertyDescriptor(prototype, key),
          enumerable: true,
        });
  }
  const history = new History(internal);
  defineEventHandlers(
    globalThis,
    (target) => {
      if (target !== globalThis) throw new TypeError("Illegal invocation");
    },
    ["popstate", "hashchange"],
  );
  const browserLocation = Object.freeze({
    get href() {
      return href;
    },
    get origin() {
      return linkValue("get", "origin", href, "");
    },
    get protocol() {
      return linkValue("get", "protocol", href, "");
    },
    get host() {
      return linkValue("get", "host", href, "");
    },
    get hostname() {
      return linkValue("get", "hostname", href, "");
    },
    get port() {
      return linkValue("get", "port", href, "");
    },
    get pathname() {
      return linkValue("get", "pathname", href, "");
    },
    get search() {
      return linkValue("get", "search", href, "");
    },
    get hash() {
      return linkValue("get", "hash", href, "");
    },
    toString: () => href,
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
    history,
    History,
    PopStateEvent,
    HashChangeEvent,
    location: browserLocation,
    Event,
    UIEvent,
    MouseEvent,
    PointerEvent,
    CustomEvent,
    ErrorEvent,
    EventTarget,
    AbortSignal,
    AbortController,
    Node,
    Attr,
    NamedNodeMap,
    Element,
    HTMLElement,
    HTMLAnchorElement,
    HTMLStyleElement,
    HTMLLinkElement,
    HTMLMediaElement,
    HTMLAudioElement,
    HTMLVideoElement,
    HTMLBodyElement,
    HTMLFrameSetElement,
    HTMLFrameElement,
    HTMLIFrameElement,
    HTMLScriptElement,
    HTMLImageElement,
    Image,
    HTMLSlotElement,
    HTMLInputElement,
    HTMLFormElement,
    HTMLButtonElement,
    HTMLOptionElement,
    HTMLSelectElement,
    HTMLOptGroupElement,
    HTMLOptionsCollection,
    Option,
    HTMLTextAreaElement,
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
    XMLDocument,
    DOMImplementation,
    DocumentFragment,
    ShadowRoot,
    DocumentType,
    NodeList,
    HTMLCollection,
    DOMTokenList,
    DOMRect,
    DOMRectReadOnly,
    MutationObserver,
    MutationRecord,
    IntersectionObserver,
    IntersectionObserverEntry,
    CharacterData,
    Text,
    Comment,
    fetch,
    Headers,
    Response,
    OffscreenCanvas,
    OffscreenCanvasRenderingContext2D,
    ImageData,
    TextMetrics,
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
    devicePixelRatio: { get: () => devicePixelRatio, enumerable: true, configurable: true },
    innerWidth: { get: () => mediaEnvironment.width, enumerable: true, configurable: true },
    innerHeight: { get: () => mediaEnvironment.height, enumerable: true, configurable: true },
    localStorage: { get: () => localStorage, enumerable: true, configurable: true },
    sessionStorage: { get: () => sessionStorage, enumerable: true, configurable: true },
  });

  const ready = (stage: "interactive" | "content" | "complete") => {
    if (stage === "complete") {
      readyState = "complete";
      dispatch(globalThis, new Event("load"), true, true);
      return;
    }
    readyState = "interactive";
    if (stage === "content")
      dispatch(document, new Event("DOMContentLoaded", { bubbles: true }), true);
  };
  const resource = (handle: number, success: boolean) => {
    if (timerTasks >= timerTaskLimit) failLimit("timer task limit");
    timerTasks++;
    dispatch(node(handle), new Event(success ? "load" : "error"), true);
  };
  // Stable engine identity matches the native and Worker HTTP transports.
  // Nimbo has no WebDriver session or shared platform state between pages.
  const navigatorInstances = new WeakSet<object>();
  class Navigator {
    constructor(key: symbol | null = null) {
      if (key !== internal) throw new TypeError("Illegal constructor");
      navigatorInstances.add(this);
    }
    javaEnabled(): boolean {
      if (!navigatorInstances.has(this)) throw new TypeError("Illegal invocation");
      return false;
    }
  }
  const navigatorValues = {
    userAgent,
    appCodeName: "Mozilla",
    appName: "Netscape",
    appVersion: "0.1",
    platform: "",
    product: "Gecko",
    productSub: "20100101",
    vendor: "",
    vendorSub: "",
    language: "en-US",
    languages: Object.freeze(["en-US"]),
    onLine: true,
    hardwareConcurrency: 1,
    cookieEnabled: true,
    webdriver: false,
    pdfViewerEnabled: false,
  };
  for (const [name, value] of Object.entries(navigatorValues)) {
    const getter = function (this: Navigator): unknown {
      if (!navigatorInstances.has(this)) throw new TypeError("Illegal invocation");
      return value;
    };
    Object.defineProperty(getter, "name", { value: `get ${name}`, configurable: true });
    Object.defineProperty(Navigator.prototype, name, {
      get: getter,
      enumerable: true,
      configurable: true,
    });
  }
  Object.defineProperty(Navigator.prototype, Symbol.toStringTag, {
    value: "Navigator",
    configurable: true,
  });
  Object.defineProperty(Navigator.prototype, "javaEnabled", {
    ...Object.getOwnPropertyDescriptor(Navigator.prototype, "javaEnabled"),
    enumerable: true,
  });
  const navigator = new Navigator(internal);
  Object.defineProperty(globalThis, "Navigator", {
    value: Navigator,
    writable: true,
    configurable: true,
  });
  const navigatorGetter = function (this: unknown): Navigator {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    return navigator;
  };
  Object.defineProperty(navigatorGetter, "name", { value: "get navigator", configurable: true });
  Object.defineProperty(globalThis, "navigator", {
    get: navigatorGetter,
    enumerable: true,
    configurable: true,
  });

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
        "elements",
        { named: true, live: true },
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
  return { ready, timer, intersections, resource, error: reportListenerError, fatal: markFatal };
})();
