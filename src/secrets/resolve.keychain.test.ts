import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  resolveSecretRefString,
  resolveSecretRefValues,
  setKeychainExecFileSyncForTests,
  SecretProviderResolutionError,
  SecretRefResolutionError,
} from "./resolve.js";

function makeConfig(
  providerOverrides: Record<string, unknown> = { source: "keychain", platform: "darwin" },
): OpenClawConfig {
  return {
    secrets: {
      providers: {
        macKeychain: providerOverrides as never,
      },
    },
  } as OpenClawConfig;
}

describe("keychain secret ref resolver", () => {
  afterEach(() => {
    setKeychainExecFileSyncForTests(null);
  });

  it("resolves a keychain ref via security CLI on darwin", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    setKeychainExecFileSyncForTests((command, args) => {
      calls.push({ command, args });
      return "sk-test-secret\n";
    });

    const value = await resolveSecretRefString(
      { source: "keychain", provider: "macKeychain", id: "elevenlabs-api-key" },
      {
        config: makeConfig({ source: "keychain", account: "elevenlabs", platform: "darwin" }),
      },
    );

    expect(value).toBe("sk-test-secret");
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("security");
    expect(calls[0].args).toEqual([
      "find-generic-password",
      "-s",
      "elevenlabs-api-key",
      "-a",
      "elevenlabs",
      "-w",
    ]);
  });

  it("omits the -a flag when no account is configured", async () => {
    const calls: string[][] = [];
    setKeychainExecFileSyncForTests((_command, args) => {
      calls.push(args);
      return "value-without-account\n";
    });

    const value = await resolveSecretRefString(
      { source: "keychain", provider: "macKeychain", id: "openai-api-key" },
      { config: makeConfig({ source: "keychain", platform: "darwin" }) },
    );

    expect(value).toBe("value-without-account");
    expect(calls[0]).toEqual(["find-generic-password", "-s", "openai-api-key", "-w"]);
  });

  it("throws SecretRefResolutionError when the security CLI exits non-zero", async () => {
    setKeychainExecFileSyncForTests(() => {
      const err = new Error("security: SecKeychainSearchCopyNext: not found");
      throw err;
    });

    await expect(
      resolveSecretRefValues([{ source: "keychain", provider: "macKeychain", id: "missing-key" }], {
        config: makeConfig({ source: "keychain", platform: "darwin" }),
      }),
    ).rejects.toBeInstanceOf(SecretRefResolutionError);
  });

  it("throws SecretRefResolutionError when the keychain returns an empty value", async () => {
    setKeychainExecFileSyncForTests(() => "\n");

    await expect(
      resolveSecretRefValues([{ source: "keychain", provider: "macKeychain", id: "empty-key" }], {
        config: makeConfig({ source: "keychain", platform: "darwin" }),
      }),
    ).rejects.toBeInstanceOf(SecretRefResolutionError);
  });

  it("throws SecretProviderResolutionError on non-darwin platforms", async () => {
    const fn = vi.fn();
    setKeychainExecFileSyncForTests(fn);

    await expect(
      resolveSecretRefValues([{ source: "keychain", provider: "macKeychain", id: "any-key" }], {
        config: makeConfig({ source: "keychain", platform: "linux" }),
      }),
    ).rejects.toBeInstanceOf(SecretProviderResolutionError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects invalid keychain ref ids before invoking the CLI", async () => {
    const fn = vi.fn();
    setKeychainExecFileSyncForTests(fn);

    await expect(
      resolveSecretRefValues([{ source: "keychain", provider: "macKeychain", id: "../escape" }], {
        config: makeConfig({ source: "keychain", platform: "darwin" }),
      }),
    ).rejects.toThrow(/Keychain secret reference id must match/);
    expect(fn).not.toHaveBeenCalled();
  });
});
