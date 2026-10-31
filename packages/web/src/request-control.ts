import {
  REGISTER_REQUEST_ROUTE,
  CANCEL_REQUEST_ROUTE,
  requestControlSchema,
  cancelRequestReplySchema,
} from "@tessera/contracts";
import { HostError, type Send } from "./host-api.ts";
import { t } from "./i18n/translate.ts";

/** One browser request owns one host capability, including its pending entry review. */
export class RequestControl {
  readonly controller = new AbortController();
  readonly #send: Send;
  #token?: string;
  #ready?: Promise<string>;
  constructor(send: Send = (url, init) => fetch(url, init)) {
    this.#send = send;
  }
  get stopped() {
    return this.controller.signal.aborted;
  }
  start(): Promise<string> {
    return (this.#ready ??= this.#post(REGISTER_REQUEST_ROUTE, {}).then(async (reply) => {
      this.#token = requestControlSchema.parse(reply).token;
      // Cancellation while registering never sends generation with the returned capability.
      if (this.stopped) await this.cancel();
      return this.#token;
    }));
  }
  async cancel(): Promise<boolean> {
    this.controller.abort();
    if (!this.#token) return true;
    const reply = await this.#post(CANCEL_REQUEST_ROUTE, { token: this.#token });
    return cancelRequestReplySchema.parse(reply).cancelled;
  }
  async #post(route: string, body: object): Promise<unknown> {
    const response = await this.#send(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // Such as "Too many requests are waiting": the server's own words, with its status.
      const said = await response.text().catch(() => "");
      throw new HostError(
        said && response.status < 500 ? said : t("request.failedPlain"),
        response.status,
      );
    }
    return response.json();
  }
  /** Stop waiting after cancellation, without aborting a request that may already have committed. */
  async wait<T>(pending: Promise<T>): Promise<T> {
    const signal = this.controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop = () => {};
    const uncertain = new Promise<never>((_, reject) => {
      stop = () => {
        timer = setTimeout(() => reject(new Error("Cancellation outcome unknown")), 10_000);
      };
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    });
    try {
      return await Promise.race([pending, uncertain]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    }
  }
}
