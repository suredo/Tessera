import { describe, expect, it, vi } from "vitest";
import { createTranslator, en, t, type MessageKey } from "../src/index.ts";

describe("translation layer", () => {
  it("returns the English text for a key (UX-05)", () => {
    expect(t("home.heading")).toBe(en["home.heading"]);
  });

  it("falls back to English for a key another language lacks, and reports it (UX-05)", () => {
    const onMissing = vi.fn();
    const pt = createTranslator("pt-BR", { "home.heading": "Descreva a ferramenta" }, onMissing);
    expect(pt("home.heading")).toBe("Descreva a ferramenta");
    expect(pt("home.intro")).toBe(en["home.intro"]);
    expect(onMissing).toHaveBeenCalledExactlyOnceWith("home.intro", "pt-BR");
  });

  it("shows the key itself when no language has it, and reports it (UX-05)", () => {
    const onMissing = vi.fn();
    const translate = createTranslator("en", en, onMissing);
    expect(translate("home.removed" as MessageKey)).toBe("home.removed");
    expect(onMissing).toHaveBeenCalledExactlyOnceWith("home.removed", "en");
  });

  it("fills {placeholders} from params and leaves unknown ones as written (UX-05)", () => {
    const translate = createTranslator("en", {
      "home.status": "{count} tools, saved by {owner}",
    });
    expect(translate("home.status", { count: 3 })).toBe("3 tools, saved by {owner}");
  });
});
