import { WasmTlsClient } from "../../../dist/wasm/nimbo_engine.js";
import { ScrapeError } from "./protocol";

const failed = () => new ScrapeError({ status: 502, reason: "proxy TLS transport failed" });

export class TlsStream {
  private readonly reader: ReadableStreamDefaultReader<unknown>;
  private readonly client: WasmTlsClient;
  private buffer: Uint8Array = new Uint8Array(0);
  private offset = 0;
  private ended = false;
  private released = false;

  constructor(
    stream: ReadableStream<unknown>,
    private readonly send: (bytes: Uint8Array) => Promise<void>,
    hostname: string,
    certificates?: string,
  ) {
    this.reader = stream.getReader();
    try {
      this.client = new WasmTlsClient(hostname, certificates);
    } catch (error) {
      this.reader.releaseLock();
      throw error;
    }
  }

  private async flush(): Promise<void> {
    const bytes = this.client.outgoing();
    if (bytes.length > 0) await this.send(bytes);
  }

  private async receive(): Promise<void> {
    if (this.offset === this.buffer.length) {
      const { value, done } = await this.reader.read();
      if (done) {
        this.client.receive(new Uint8Array(0));
        this.ended = true;
        return;
      }
      if (!(value instanceof Uint8Array)) throw failed();
      this.buffer = value;
      this.offset = 0;
    }
    const consumed = this.client.receive(
      this.buffer.subarray(this.offset, Math.min(this.buffer.length, this.offset + 65_536)),
    );
    if (consumed === 0) throw failed();
    this.offset += consumed;
    await this.flush();
  }

  async open(): Promise<void> {
    await this.flush();
    while (this.client.handshaking()) {
      if (this.ended) throw failed();
      // Each handshake flight depends on the preceding authenticated TLS state.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await this.receive();
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    for (let offset = 0; offset < bytes.length; offset += 16_384) {
      this.client.write(bytes.subarray(offset, offset + 16_384));
      // Flush each bounded record before queuing the next application fragment.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await this.flush();
    }
  }

  async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
    while (true) {
      const bytes = this.client.read();
      if (bytes.length > 0) return { done: false, value: bytes };
      if (this.ended || this.client.peer_closed()) return { done: true, value: undefined };
      // TLS records may be fragmented and contain no application bytes.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await this.receive();
    }
  }

  releaseLock(): void {
    if (this.released) return;
    this.released = true;
    this.reader.releaseLock();
    this.client.free();
  }
}
