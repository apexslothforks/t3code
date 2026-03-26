interface ProviderStartOptions {
  readonly codex?: {
    readonly binaryPath?: string;
    readonly homePath?: string;
  };
}

interface LegacyCodexPathSettings {
  readonly codexBinaryPath: string;
  readonly codexHomePath: string;
}

export function buildCodexProviderOptions(
  settings:
    | LegacyCodexPathSettings
    | {
        readonly providers: {
          readonly codex: {
            readonly binaryPath: string;
            readonly homePath: string;
          };
        };
      },
): ProviderStartOptions | undefined {
  const binaryPath =
    "providers" in settings
      ? settings.providers.codex.binaryPath.trim()
      : settings.codexBinaryPath.trim();
  const homePath =
    "providers" in settings
      ? settings.providers.codex.homePath.trim()
      : settings.codexHomePath.trim();

  if (binaryPath.length === 0 && homePath.length === 0) {
    return undefined;
  }

  return {
    codex: {
      ...(binaryPath.length > 0 ? { binaryPath } : {}),
      ...(homePath.length > 0 ? { homePath } : {}),
    },
  };
}
