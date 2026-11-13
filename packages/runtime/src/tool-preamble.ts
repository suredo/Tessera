import type { BridgeMethodName } from "@tessera/contracts";

// Runs first in the tool's document, before the tool's own code (RUN-01). It says hello to the
// wrapper as the page loads, takes the one port the wrapper hands over in answer, and gives the tool
// `tessera`, its only way to talk to the host. The server inlines it, so it is a plain script: no
// runtime imports, and the protocol names repeat src/protocol.ts.
(() => {
  const HELLO_MESSAGE = "tessera:hello";
  const PORT_MESSAGE = "tessera:port";
  // The tool's frame sits in a page frame of the wrapper's own, made for this page alone: the
  // page says hello to that frame, its parent, and takes its port from the wrapper around it.
  const pageFrame = parent;
  const wrapper = parent.parent;
  let port: MessagePort | undefined;
  // What the page says before it has its port, in order, each in its envelope.
  const waiting: object[] = [];
  const listeners = new Set<(message: unknown) => void>();
  type Pending = { resolve(result: unknown): void; reject(error: Error): void };
  const pending = new Map<string, Pending>();
  // Request IDs start with a mark of this page, so a late reply for a page the tool left can't
  // settle a call of the page that replaced it (SBX-07).
  const page = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  let lastCall = 0;
  // Counts calls made and settled, so a behavior check can tell a quiet moment from a busy one.
  let activity = 0;

  // A waiting envelope is copied now, as the port would copy it, so what can't be sent fails here,
  // and a later change to it by the tool doesn't change what is sent.
  const post = (envelope: object) => {
    if (port) port.postMessage(envelope);
    else waiting.push(structuredClone(envelope));
  };

  // Only the first port, from the wrapper, is taken.
  addEventListener("message", (event: MessageEvent) => {
    if (port || event.source !== wrapper) return;
    const data = event.data as { type?: unknown };
    const given = event.ports[0];
    if (data?.type !== PORT_MESSAGE || !given) return;
    port = given;
    // On the port, the host's messages come as { message }, replies to calls as { reply }, and the
    // watchdog's pings as { ping }, which is answered at once: an answer shows the tool's page
    // isn't stuck (RUN-02). The tool's code shares this window and can reach the port too, so
    // nothing sent on it proves more than the tool says: the wrapper sees real input itself.
    port.onmessage = (e: MessageEvent) => {
      const data = e.data as { message?: unknown; ping?: unknown; reply?: unknown };
      if (data && "ping" in data) port?.postMessage({ pong: data.ping });
      else if (data && "reply" in data) settle(data.reply);
      else if (data && "inspect" in data) void inspect((data as { inspect?: unknown }).inspect);
      else if (data && "drive" in data) void drive((data as { drive?: unknown }).drive);
      else listeners.forEach((listen) => listen(data?.message));
    };
    for (const envelope of waiting.splice(0)) port.postMessage(envelope);
  });

  // A reply settles the call it names; any other is dropped.
  function settle(reply: unknown) {
    const r = reply as {
      requestId?: unknown;
      ok?: unknown;
      result?: unknown;
      error?: { code?: unknown; message?: unknown };
    } | null;
    const call = typeof r?.requestId === "string" ? pending.get(r.requestId) : undefined;
    if (!call || !r) return;
    pending.delete(r.requestId as string);
    activity += 1;
    if (r.ok === true) return call.resolve(r.result);
    const message = r.error?.message;
    const error = new Error(typeof message === "string" ? message : "The host refused the call.");
    call.reject(Object.assign(error, { code: r.error?.code }));
  }

  // What went wrong as the tool started and ran, for the smoke check (VER-02): recorded from
  // before the tool's code, so its first error counts too. A few, each cut short.
  const problems: string[] = [];
  const note = (text: string) => {
    if (problems.length < 10) problems.push(text.slice(0, 300));
  };
  addEventListener(
    "error",
    (event: Event) => {
      if (event instanceof ErrorEvent) note(`An error: ${event.message}`);
      else if (event.target instanceof Element) {
        note(`A <${event.target.tagName.toLowerCase()}> couldn't load.`);
      }
    },
    true,
  );
  addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason as { message?: unknown } | undefined;
    note(`An error nothing handled: ${String(reason?.message ?? event.reason)}`);
  });
  addEventListener("securitypolicyviolation", (event: SecurityPolicyViolationEvent) => {
    note(`Something the tool tried was blocked (${event.effectiveDirective}).`);
  });

  // When the tool's own code had run: its script ends the document, so by DOMContentLoaded it has,
  // and any timer it set counts from about then. A slow page load comes before this, not after.
  const codeRan = new Promise<number>((done) => {
    if (document.readyState !== "loading") done(performance.now());
    else addEventListener("DOMContentLoaded", () => done(performance.now()), { once: true });
  });

  // The smoke check's question: once the tool's calls have settled (or 3 seconds have passed),
  // what it shows, whether it scrolls sideways, and the accessibility floor's basics.
  const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
  // Until the tool's calls have settled, or 3 seconds have passed.
  const settled = async () => {
    for (let waited = 0; pending.size > 0 && waited < 3000; waited += 50) await wait(50);
  };
  // Until this frame has its width, or 5 seconds have passed. On a cold browser Chrome could leave
  // a nested frame without its size for seconds; a check that measured it then saw a page as wide
  // as its widest control and no element shown (#302). The staging panel lies inside the window,
  // so Chrome doesn't hold the frame's rendering back (#337), and the wrapper lays the frames out
  // while a check waits (wrapper.ts); the checks measure the tool only once its frame has its width.
  const NO_SIZE =
    "Tessera couldn't see the tool: its frame still had no size after 5 seconds. This is Tessera's problem, not the tool's.";
  const sized = async () => {
    for (let waited = 0; window.innerWidth === 0 && waited < 5000; waited += 50) await wait(50);
  };
  // Settled, then 50 quiet ms to show the result: a call made or settled in that time starts the
  // wait again, a bounded number of times.
  const shown = async () => {
    await sized();
    for (let rounds = 0; rounds < 20; rounds += 1) {
      await settled();
      const seen = activity;
      await wait(50);
      if (pending.size === 0 && activity === seen) return;
    }
  };

  // A behavior check's question (VER-03): steps on the elements the tool marks with a hook name
  // in its `data-hook` attribute, one at a time, each once the tool's calls have settled and it
  // has had a moment to show the result. The first step that can't be done ends the answer, with
  // what was missing. Like the smoke check's report, the answer is the page's word.
  async function drive(question: unknown) {
    const q = question as { id?: unknown; steps?: unknown } | null;
    if (typeof q?.id !== "number" || !Array.isArray(q.steps)) return;
    await codeRan;
    await shown();
    const results: object[] = [];
    for (const raw of q.steps as unknown[]) {
      const step = raw as {
        do?: unknown;
        hook?: unknown;
        index?: unknown;
        value?: unknown;
        start?: unknown;
      };
      const hook = typeof step?.hook === "string" ? step.hook : "";
      // A frame still without its size can't show anything, so nothing found then is Tessera's
      // problem, not the tool's: said so, rather than that the tool lacks the hook (#308, L-91).
      if (window.innerWidth === 0) {
        results.push({ ok: false, problem: NO_SIZE });
        break;
      }
      if (!/^[a-z][a-z0-9-]{0,40}$/.test(hook)) {
        results.push({ ok: false, problem: `"${hook.slice(0, 50)}" isn't a hook name.` });
        break;
      }
      // Only what the page shows: an element hidden, as a filter may hide an item, isn't there for
      // the person, so it isn't for the check either.
      const found = [...document.querySelectorAll(`[data-hook~="${hook}"]`)].filter((element) =>
        element.checkVisibility({ visibilityProperty: true }),
      );
      const textOf = (element: Element) =>
        (element instanceof HTMLElement ? element.innerText : (element.textContent ?? ""))
          .trim()
          .replace(/\s+/g, " ");
      // A fingerprint of a whole text, so a check can tell texts apart past the part a read gives.
      const digest = (text: string) => {
        let h1 = 0xdeadbeef;
        let h2 = 0x41c6ce57;
        for (let i = 0; i < text.length; i++) {
          const code = text.charCodeAt(i);
          h1 = Math.imul(h1 ^ code, 2654435761);
          h2 = Math.imul(h2 ^ code, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
      };
      if (step.do === "read") {
        // At most 100 texts a read, from `start`, so a long list is read a page at a time.
        const start = typeof step.start === "number" && step.start > 0 ? Math.floor(step.start) : 0;
        const whole = found.slice(start, start + 100).map(textOf);
        const texts = whole.map((text) => text.slice(0, 200));
        results.push({ ok: true, count: found.length, texts, digests: whole.map(digest) });
        continue;
      }
      // Which of them, by position, show `text`: however many there are, the first 20 from
      // `start`, so a check can ask whether one at a known position does.
      // A loose find compares as a person reads: capitals and repeated spaces aside (VER-09).
      if (step.do === "find") {
        const loose = (step as { loose?: unknown }).loose === true;
        const fold = (text: string) =>
          loose ? text.replace(/\s+/g, " ").trim().toLowerCase() : text;
        const text = fold(String(step.value));
        const start = typeof step.start === "number" && step.start > 0 ? Math.floor(step.start) : 0;
        const matches: number[] = [];
        found.forEach((element, at) => {
          if (at >= start && matches.length < 20 && fold(textOf(element)).includes(text)) {
            matches.push(at);
          }
        });
        results.push({ ok: true, count: found.length, matches });
        continue;
      }
      // What each chart shows, as the helper drew it: for the first 20, the chart drawn in the
      // element or inside it, or null.
      if (step.do === "chart") {
        // A chart counts only while its canvas is still in its element: one the tool has since
        // taken away isn't shown, so it is let go.
        for (const [at, entry] of [...charts]) {
          if (!entry.canvas.isConnected || !at.contains(entry.canvas)) {
            entry.chart.destroy();
            charts.delete(at);
          }
        }
        const drawn = [...charts.entries()];
        const shown = found.slice(0, 20).map((element) => {
          const entry = drawn.find(([at]) => at === element || element.contains(at));
          return entry ? entry[1].spec : null;
        });
        results.push({ ok: true, count: found.length, charts: shown });
        continue;
      }
      // The date each marks, 100 from `start`: its own datetime if it is a time element, or else
      // that of the first time element inside it with one, as YYYY-MM-DD, or null when neither is
      // a real date, or a date and time, in the form HTML gives them, so a check reads dates
      // whatever language the page shows them in.
      if (step.do === "dates") {
        const start = typeof step.start === "number" && step.start > 0 ? Math.floor(step.start) : 0;
        const dates = found.slice(start, start + 100).map((element) => {
          const time =
            element instanceof HTMLTimeElement && element.hasAttribute("datetime")
              ? element
              : element.querySelector("time[datetime]");
          const value = time instanceof HTMLTimeElement ? time.dateTime.trim() : "";
          const parts =
            /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?$/.exec(
              value,
            );
          if (!parts) return null;
          const [year, month, day, hour, minute, second, zoneHours, zoneMinutes] = parts
            .slice(1)
            .map((part) => (part === undefined ? 0 : Number(part)));
          const leap = (year! % 4 === 0 && year! % 100 !== 0) || year! % 400 === 0;
          const length = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month! - 1];
          // A real date, and a real time and zone when it gives them; no leap second.
          const real =
            year! >= 1 &&
            length !== undefined &&
            day! >= 1 &&
            day! <= length &&
            hour! <= 23 &&
            minute! <= 59 &&
            second! <= 59 &&
            zoneHours! <= 23 &&
            zoneMinutes! <= 59;
          return real ? value.slice(0, 10) : null;
        });
        results.push({ ok: true, count: found.length, dates });
        continue;
      }
      // What each field is, so a check can fill it with a value it takes: the first 100.
      if (step.do === "fields") {
        const fields = found.slice(0, 100).map((element) => {
          const input = element instanceof HTMLInputElement ? element : undefined;
          const select = element instanceof HTMLSelectElement ? element : undefined;
          const area = element instanceof HTMLTextAreaElement ? element : undefined;
          return {
            kind: input ? "input" : select ? "select" : area ? "textarea" : "other",
            type: input ? input.type : "",
            name: (input ?? select ?? area)?.name.slice(0, 100) ?? "",
            required: Boolean((input ?? select ?? area)?.required),
            checked: Boolean(input?.checked),
            min: input?.min.slice(0, 40) ?? "",
            max: input?.max.slice(0, 40) ?? "",
            step: input?.step.slice(0, 40) ?? "",
            maxLength: (input ?? area)?.maxLength ?? -1,
            choices: select
              ? [...select.options]
                  .filter((option) => !option.disabled)
                  .slice(0, 50)
                  .map((option) => option.value.slice(0, 200))
              : [],
            value: (input ?? select ?? area)?.value.slice(0, 200) ?? "",
          };
        });
        results.push({ ok: true, count: found.length, fields });
        continue;
      }
      const index = typeof step.index === "number" ? step.index : 0;
      const element = found[index];
      if (!element) {
        results.push({
          ok: false,
          problem:
            found.length === 0
              ? `Nothing shown has the hook "${hook}".`
              : `Only ${found.length} ${found.length === 1 ? "element shown has" : "elements shown have"} the hook "${hook}", so there is no number ${index + 1}.`,
        });
        break;
      }
      const value = String(step.value);
      // A select is filled by choosing the choice whose value or text is the value, as a person
      // picks by what it says.
      const choice =
        element instanceof HTMLSelectElement
          ? ([...element.options].find((option) => option.value === value) ??
            [...element.options].find((option) => textOf(option) === value.trim()))
          : undefined;
      if (step.do === "fill" && element instanceof HTMLSelectElement && !choice) {
        results.push({
          ok: false,
          problem: `The select with the hook "${hook}" has no choice ${value ? `"${value.slice(0, 60)}"` : "with an empty value"}.`,
        });
        break;
      }
      if (step.do === "click" && element instanceof HTMLElement) element.click();
      else if (
        step.do === "fill" &&
        (element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement)
      ) {
        // Through the prototype's setter, as typing would, then the events typing gives.
        const prototype = Object.getPrototypeOf(element) as object;
        Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
          element,
          choice ? choice.value : value,
        );
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        results.push({
          ok: false,
          problem: `The element with the hook "${hook}" can't be ${step.do === "fill" ? "filled in" : "clicked"}.`,
        });
        break;
      }
      await shown();
      results.push({ ok: true });
    }
    post({ report: { id: q.id, problems: [...problems], steps: results } });
  }

  async function inspect(id: unknown) {
    await settled();
    // Watched for at least two seconds after the tool's code ran, so an error a quiet tool makes a
    // moment after starting is seen too, however long the page took to load (#214).
    const ran = await codeRan;
    await wait(Math.max(100, ran + 2000 - performance.now()));
    await sized();
    const body = document.body;
    const all = (selector: string) => (body ? [...body.querySelectorAll(selector)] : []);
    // Visible: rendered, not hidden by CSS visibility, and not fully transparent.
    const visible = (element: Element) => {
      if (typeof element.checkVisibility === "function") {
        return element.checkVisibility({ visibilityProperty: true, opacityProperty: true });
      }
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    // Hidden from assistive technology, by the accessible-name rules: not by how it looks, so
    // text in a box of its own (display: contents) or a transparent one still names.
    const hiddenFromReaders = (element: Element) => {
      if (element.getAttribute("aria-hidden") === "true" || element.hasAttribute("hidden")) {
        return true;
      }
      const style = getComputedStyle(element);
      return (
        style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
      );
    };
    // The text a name comes from, as assistive technology reads it (accessible-name rules): text,
    // an image's alt text and an element's aria-label. What is hidden is left out, except under
    // an element that aria-labelledby names and that is itself hidden: then all its text counts.
    const textOf = (node: Node, includeHidden = false): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof Element)) return "";
      if (!includeHidden && hiddenFromReaders(node)) return "";
      const label = node.getAttribute("aria-label")?.trim();
      if (label) return label;
      if (node instanceof HTMLImageElement) return node.alt;
      return [...node.childNodes].map((child) => textOf(child, includeHidden)).join(" ");
    };
    const labelledBy = (element: Element) =>
      (element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .map((ref) => (ref ? document.getElementById(ref) : null))
        .map((target) => (target ? textOf(target, hiddenFromReaders(target)) : ""))
        .join(" ")
        .trim();
    const ownName = (element: Element) =>
      labelledBy(element) ||
      element.getAttribute("aria-label")?.trim() ||
      element.getAttribute("title")?.trim() ||
      "";
    const fieldName = (field: Element) =>
      ownName(field) ||
      [...((field as HTMLInputElement).labels ?? [])]
        .map((label) => textOf(label))
        .join(" ")
        .trim();
    // A button's own text: what it holds, less what is hidden inside it.
    const buttonName = (button: Element) =>
      ownName(button) ||
      (button instanceof HTMLInputElement
        ? button.value.trim()
        : [...button.childNodes]
            .map((child) => textOf(child))
            .join(" ")
            .trim());
    // Shown: laid out with a size, and visible.
    const shown = (element: Element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && visible(element);
    };
    const fields = all(
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea",
    );
    const buttons = all(
      "button, [role=button], input[type=button], input[type=submit], input[type=reset]",
    );
    const root = document.documentElement;
    // A frame still without its size can't be measured: said so, as Tessera's problem, and its
    // width isn't read as the tool scrolling sideways (#308, L-91).
    const unsized = window.innerWidth === 0;
    post({
      report: {
        id,
        problems: unsized ? [...problems, NO_SIZE] : [...problems],
        elements: all("*").length,
        text: body ? body.innerText.trim().length : 0,
        media: all("canvas, svg, img, video").filter(shown).length,
        overflow: unsized
          ? 0
          : Math.max(root.scrollWidth, body?.scrollWidth ?? 0) - root.clientWidth,
        unlabeled: fields.filter((field) => !fieldName(field)).length,
        unnamed: buttons.filter((button) => !buttonName(button)).length,
        noAlt: all("img:not([alt])").length,
      },
    });
  }

  // Registered before the tool's code, so it runs first. A page in this frame that never says hello,
  // such as a blank or a blocked one, isn't the tool's: the wrapper starts the tool again (SBX-07).
  addEventListener("load", () => pageFrame.postMessage({ type: HELLO_MESSAGE }, "*"), {
    capture: true,
    once: true,
  });

  // The chart helper (CAP-04, ADR 0014). A tool that declares chart gets Chart.js in a script just
  // before this one; it is taken here and removed from the page, so a tool draws only through
  // tessera.chart. The server writes in the spec's shape and the standard's chart styles, each
  // from its one definition (P3).
  type ChartSpecLike = {
    type: string;
    title: string;
    labels: string[];
    series: { name: string; values: number[] }[];
  };
  type ChartInstance = { destroy(): void };
  type ChartLibrary = (new (canvas: HTMLCanvasElement, config: object) => ChartInstance) & {
    defaults: { font: { family?: string; size?: number }; color?: string; borderColor?: string };
  };
  const chartPage = window as unknown as { Chart?: ChartLibrary };
  const chartLibrary = chartPage.Chart;
  delete chartPage.Chart;
  const CHART = JSON.parse("__TESSERA_CHART__") as {
    schema: unknown;
    styles: Record<string, string>;
  };
  // What each element shows, for a behavior check, and the chart drawn in it.
  const charts = new Map<
    Element,
    { spec: ChartSpecLike; chart: ChartInstance; canvas: HTMLCanvasElement }
  >();

  // The spec's rules, from the contract (P3): its shape's JSON Schema, in CHART, applied by the
  // contracts' schemaProblem, and the rules that tie its fields together, chartSpecRelations. The
  // server writes in both functions' source here, so the page restates none of it.
  const schemaProblem = /*__TESSERA_SCHEMA_PROBLEM__*/ undefined as unknown as (
    value: unknown,
    schema: unknown,
  ) => string | null;
  const chartSpecRelations = /*__TESSERA_CHART_RELATIONS__*/ undefined as unknown as (
    spec: ChartSpecLike,
  ) => string | null;

  /** `spec` as the helper draws it, a copy, or an error saying in plain words what is wrong. */
  function checkChart(spec: unknown): ChartSpecLike {
    const problem = schemaProblem(spec, CHART.schema) ?? chartSpecRelations(spec as ChartSpecLike);
    if (problem) throw new Error(`tessera.chart can't draw this chart: ${problem}`);
    const s = spec as ChartSpecLike;
    return {
      type: s.type,
      title: s.title,
      labels: [...s.labels],
      series: s.series.map((one) => ({ name: one.name, values: [...one.values] })),
    };
  }

  /** A style for charts in `element`: the tool's `--ui-*` value, or else the standard's. */
  const chartStyle = (element: Element, name: string) =>
    getComputedStyle(element).getPropertyValue(`--ui-${name}`).trim() || (CHART.styles[name] ?? "");

  /** Draws `spec` in `element`, in place of what it held (CAP-04). */
  function chart(element: unknown, spec: unknown): void {
    if (!chartLibrary) {
      throw new Error("tessera.chart needs the chart capability, which this tool doesn't declare.");
    }
    if (!(element instanceof HTMLElement)) {
      throw new Error("tessera.chart needs the element to draw the chart in.");
    }
    const checked = checkChart(spec);
    charts.get(element)?.chart.destroy();
    activity += 1;

    const palette = [1, 2, 3, 4, 5, 6].map((n) => chartStyle(element, `chart-${n}`));
    const text = chartStyle(element, "text");
    const grid = chartStyle(element, "divider");
    chartLibrary.defaults.font.family = chartStyle(element, "font");
    chartLibrary.defaults.font.size =
      Number.parseFloat(chartStyle(element, "size-secondary")) || 14;
    chartLibrary.defaults.color = text;
    chartLibrary.defaults.borderColor = grid;

    // The chart, an image named by its title, and beside it a table of the same numbers that only
    // a screen reader reaches.
    const frame = document.createElement("div");
    frame.style.position = "relative";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", checked.title);
    frame.append(canvas);
    const table = document.createElement("table");
    const hidden = document.createElement("div");
    Object.assign(hidden.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      clipPath: "inset(50%)",
      whiteSpace: "nowrap",
    });
    const caption = document.createElement("caption");
    caption.textContent = checked.title;
    const cell = (tag: "th" | "td", content: string) => {
      const made = document.createElement(tag);
      made.textContent = content;
      return made;
    };
    const head = document.createElement("tr");
    head.append(cell("th", ""), ...checked.series.map((one) => cell("th", one.name)));
    const rows = checked.labels.map((label, i) => {
      const row = document.createElement("tr");
      row.append(
        cell("th", label),
        ...checked.series.map((one) => cell("td", String(one.values[i]))),
      );
      return row;
    });
    table.append(caption, head, ...rows);
    hidden.append(table);
    element.replaceChildren(frame, hidden);

    const round = checked.type === "pie" || checked.type === "doughnut";
    const instance = new chartLibrary(canvas, {
      type: checked.type,
      data: {
        labels: checked.labels,
        datasets: checked.series.map((one, i) => ({
          label: one.name,
          data: one.values,
          backgroundColor: round
            ? checked.labels.map((_, j) => palette[j % palette.length])
            : palette[i % palette.length],
          borderColor: round ? chartStyle(element, "surface") : palette[i % palette.length],
        })),
      },
      options: {
        animation: false,
        events: [],
        responsive: true,
        plugins: {
          title: { display: true, text: checked.title },
          legend: { display: round || checked.series.length > 1 },
          tooltip: { enabled: false },
        },
      },
    });
    charts.set(element, { spec: checked, chart: instance, canvas });
  }

  Object.defineProperty(window, "tessera", {
    value: Object.freeze({
      /** Sends a message to the host; it waits until the bridge is ready. */
      send(message: unknown) {
        post({ message });
      },
      /** Calls `listen` with every message from the host; returns a way to stop. */
      onMessage(listen: (message: unknown) => void) {
        listeners.add(listen);
        return () => listeners.delete(listen);
      },
      call,
      /** Draws a chart from `spec` in `element` (CAP-04), for a tool that declares chart. */
      chart,
      /**
       * A blob: URL showing the image `id` names, from the host's asset.read (DATA-11): the tool
       * gets bytes and a type, never a file path. Rejects as call does.
       */
      async assetUrl(id: string): Promise<string> {
        const { type, bytesBase64 } = (await call("asset.read", { id })) as {
          type: string;
          bytesBase64: string;
        };
        const text = atob(bytesBase64);
        const bytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
        return URL.createObjectURL(new Blob([bytes], { type }));
      },
    } satisfies Record<BridgeMethodName, unknown>),
    enumerable: true,
  });

  /**
   * Asks the host to do `action` (CON-03); resolves with its result, or rejects with an error
   * whose `code` says why it was refused.
   */
  function call(action: string, args: unknown = {}): Promise<unknown> {
    lastCall += 1;
    activity += 1;
    const requestId = `p${page}-c${lastCall}`;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      try {
        post({ call: { requestId, action, args } });
      } catch (error) {
        // Something the port can't carry, such as a function.
        pending.delete(requestId);
        reject(error instanceof Error ? error : new Error("The call couldn't be sent."));
      }
    });
  }
})();
