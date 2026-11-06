import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { STAGES } from "@tessera/contracts";
import { en } from "../src/i18n/en.ts";
import { stageText } from "../src/progress.ts";
import { RequestBox } from "../src/RequestBox.tsx";
import { RequestControl } from "../src/request-control.ts";

// Progress while a request runs (GEN-16, CLI-07, ADR 0010): stage names and elapsed time.

it("GEN-16: each stage a request goes through has plain words, and any other is the working message", () => {
  expect(stageText("waiting")).toBe(en["request.stage.waiting"]);
  expect(stageText("intent")).toBe(en["request.stage.intent"]);
  expect(stageText("create")).toBe(en["request.stage.create"]);
  expect(stageText("edit")).toBe(en["request.stage.edit"]);
  expect(stageText("repair")).toBe(en["request.stage.repair"]);
  expect(stageText("data")).toBe(en["request.stage.data"]);
  expect(stageText(null)).toBe(en["request.working"]);
  for (const stage of STAGES) expect(stageText(stage)).not.toBe("");
});

it("GEN-16 UX-02 APP-10: the stage is the announced status, and the seconds sit outside it", () => {
  const html = renderToStaticMarkup(
    <RequestBox
      working
      progress={{ status: en["request.stage.create"], elapsed: "40 s" }}
      onRequest={() => Promise.resolve()}
    />,
  );
  expect(html).toContain(`<p role="status">${en["request.stage.create"]}</p>`);
  expect(html).toContain('<p class="request-elapsed">40 s</p>');
  const idle = renderToStaticMarkup(
    <RequestBox working={false} onRequest={() => Promise.resolve()} />,
  );
  expect(idle).toContain('<p role="status"></p>');
  expect(idle).not.toContain("request-elapsed");
});

it("GEN-16: progress is asked for with the request's own capability, and not before it has one", async () => {
  const token = "00000000-0000-4000-8000-000000000001";
  const sent: [string, unknown][] = [];
  const owner = new RequestControl((url, init) => {
    sent.push([String(url), JSON.parse(typeof init?.body === "string" ? init.body : "{}")]);
    return Promise.resolve(
      Response.json(
        String(url).endsWith("register") ? { token } : { stage: "create", seconds: 12 },
      ),
    );
  });
  expect(await owner.progress()).toEqual({ stage: null, seconds: 0 });
  expect(sent).toEqual([]);
  await owner.start();
  expect(await owner.progress()).toEqual({ stage: "create", seconds: 12 });
  expect(sent.at(-1)).toEqual(["/api/generate/progress", { token }]);
});
