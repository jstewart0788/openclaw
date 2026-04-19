import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Regression test for prompt-cache stability. The Anthropic prompt cache keys
// on the exact bytes of the serialized tool-definitions prefix. If plugin tool
// ordering follows plugin registration order (Map/filesystem iteration), the
// prefix drifts between turns and invalidates the cache on every request.
//
// See the "Prompt Cache Stability" section of CLAUDE.md. `resolvePluginTools`
// must sort its output by a stable key before handing tools to the prompt
// assembler.

type MockRegistryToolEntry = {
  pluginId: string;
  optional: boolean;
  source: string;
  names: string[];
  factory: (ctx: unknown) => unknown;
};

const loadOpenClawPluginsMock = vi.fn();
const resolveRuntimePluginRegistryMock = vi.fn();
const applyPluginAutoEnableMock = vi.fn();

vi.mock("./loader.js", () => ({
  resolveRuntimePluginRegistry: (params: unknown) => resolveRuntimePluginRegistryMock(params),
}));

vi.mock("../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: (params: unknown) => applyPluginAutoEnableMock(params),
}));

let resolvePluginTools: typeof import("./tools.js").resolvePluginTools;
let resetPluginRuntimeStateForTest: typeof import("./runtime.js").resetPluginRuntimeStateForTest;

function makeTool(name: string) {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
}

function createContext() {
  return {
    config: {
      plugins: {
        enabled: true,
        allow: ["alpha", "bravo", "charlie", "delta"],
        load: { paths: ["/tmp/plugin.js"] },
      },
    },
    workspaceDir: "/tmp",
  };
}

function setRegistry(entries: MockRegistryToolEntry[]) {
  const registry = {
    tools: entries,
    diagnostics: [] as Array<{
      level: string;
      pluginId: string;
      source: string;
      message: string;
    }>,
  };
  loadOpenClawPluginsMock.mockReturnValue(registry);
  return registry;
}

function makeEntry(pluginId: string, toolName: string): MockRegistryToolEntry {
  return {
    pluginId,
    optional: false,
    source: `/tmp/${pluginId}.js`,
    names: [toolName],
    factory: () => makeTool(toolName),
  };
}

// Serialize the tools the way a prompt builder would: stable JSON of each
// tool's name+description. This is the "prefix" proxy the cache would see.
function serializeToolPrefix(tools: ReturnType<typeof resolvePluginTools>): string {
  return JSON.stringify(
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  );
}

describe("resolvePluginTools prompt-cache prefix stability", () => {
  beforeAll(async () => {
    ({ resolvePluginTools } = await import("./tools.js"));
    ({ resetPluginRuntimeStateForTest } = await import("./runtime.js"));
  });

  beforeEach(() => {
    loadOpenClawPluginsMock.mockClear();
    resolveRuntimePluginRegistryMock.mockReset();
    resolveRuntimePluginRegistryMock.mockImplementation((params) =>
      loadOpenClawPluginsMock(params),
    );
    applyPluginAutoEnableMock.mockReset();
    applyPluginAutoEnableMock.mockImplementation(({ config }: { config: unknown }) => ({
      config,
      changes: [],
    }));
    resetPluginRuntimeStateForTest?.();
  });

  afterEach(() => {
    resetPluginRuntimeStateForTest?.();
  });

  it("produces a byte-identical serialized prefix regardless of registration order", () => {
    const registrationOrderA: MockRegistryToolEntry[] = [
      makeEntry("delta", "delta_tool"),
      makeEntry("alpha", "alpha_tool"),
      makeEntry("charlie", "charlie_tool"),
      makeEntry("bravo", "bravo_tool"),
    ];
    const registrationOrderB: MockRegistryToolEntry[] = [
      makeEntry("alpha", "alpha_tool"),
      makeEntry("bravo", "bravo_tool"),
      makeEntry("charlie", "charlie_tool"),
      makeEntry("delta", "delta_tool"),
    ];
    const registrationOrderC: MockRegistryToolEntry[] = [
      makeEntry("charlie", "charlie_tool"),
      makeEntry("delta", "delta_tool"),
      makeEntry("alpha", "alpha_tool"),
      makeEntry("bravo", "bravo_tool"),
    ];

    setRegistry(registrationOrderA);
    const prefixA = serializeToolPrefix(resolvePluginTools({ context: createContext() as never }));

    setRegistry(registrationOrderB);
    const prefixB = serializeToolPrefix(resolvePluginTools({ context: createContext() as never }));

    setRegistry(registrationOrderC);
    const prefixC = serializeToolPrefix(resolvePluginTools({ context: createContext() as never }));

    // All three prefixes must be identical — this is the cache-stability
    // contract. A mismatch here means the tool-definitions prefix drifts with
    // plugin registration order and the Anthropic prompt cache will miss on
    // every turn.
    expect(prefixB).toBe(prefixA);
    expect(prefixC).toBe(prefixA);

    // Sanity: the expected stable order is alphabetical by pluginId.
    expect(prefixA).toBe(
      JSON.stringify([
        { name: "alpha_tool", description: "alpha_tool tool" },
        { name: "bravo_tool", description: "bravo_tool tool" },
        { name: "charlie_tool", description: "charlie_tool tool" },
        { name: "delta_tool", description: "delta_tool tool" },
      ]),
    );
  });

  it("keeps the prefix stable when the same plugin registers multiple tool entries in varying order", () => {
    const entryOrderA: MockRegistryToolEntry[] = [
      makeEntry("bravo", "bravo_two"),
      makeEntry("alpha", "alpha_one"),
      makeEntry("bravo", "bravo_one"),
      makeEntry("alpha", "alpha_two"),
    ];
    const entryOrderB: MockRegistryToolEntry[] = [
      makeEntry("alpha", "alpha_two"),
      makeEntry("bravo", "bravo_one"),
      makeEntry("alpha", "alpha_one"),
      makeEntry("bravo", "bravo_two"),
    ];

    setRegistry(entryOrderA);
    const prefixA = serializeToolPrefix(resolvePluginTools({ context: createContext() as never }));

    setRegistry(entryOrderB);
    const prefixB = serializeToolPrefix(resolvePluginTools({ context: createContext() as never }));

    expect(prefixB).toBe(prefixA);
    expect(prefixA).toBe(
      JSON.stringify([
        { name: "alpha_one", description: "alpha_one tool" },
        { name: "alpha_two", description: "alpha_two tool" },
        { name: "bravo_one", description: "bravo_one tool" },
        { name: "bravo_two", description: "bravo_two tool" },
      ]),
    );
  });
});
