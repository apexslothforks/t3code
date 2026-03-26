import { describe, expect, it } from "vitest";

import { buildCodexProviderOptions } from "./codexProviderOptions";

describe("buildCodexProviderOptions", () => {
  it("returns undefined when no custom codex settings are configured", () => {
    expect(
      buildCodexProviderOptions({
        codexBinaryPath: "",
        codexHomePath: " ",
      }),
    ).toBeUndefined();
  });

  it("returns trimmed codex provider options when configured", () => {
    expect(
      buildCodexProviderOptions({
        codexBinaryPath: " /home/fl/.local/bin/codex-swap ",
        codexHomePath: " /home/fl/.codex ",
      }),
    ).toEqual({
      codex: {
        binaryPath: "/home/fl/.local/bin/codex-swap",
        homePath: "/home/fl/.codex",
      },
    });
  });
});
