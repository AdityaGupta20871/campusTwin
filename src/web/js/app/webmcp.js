/**
 * WebMCP bridge: registers the studio's typed tools with the browser's model context
 * (navigator.modelContext — emerging W3C WebMCP API) so in-browser AI agents can call them.
 * Calls flow through the same executor as human clicks, so they are validated and attributed ("webmcp").
 */

export function getModelContext(win = globalThis) {
  return win.navigator?.modelContext ?? win.document?.modelContext ?? null;
}

export function toWebMcpTool(tool, executor) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: tool.readOnly },
    async execute(args) {
      const res = await executor.execute(tool.name, args ?? {}, { actor: "webmcp" });
      return {
        content: [{ type: "text", text: JSON.stringify(res.ok ? res.data : { error: res.error }) }],
        isError: !res.ok,
      };
    },
  };
}

/** Returns { supported, registered, error? }. Never throws: WebMCP is optional progressive enhancement. */
export function registerWebMcpTools(executor, { modelContext = getModelContext() } = {}) {
  if (!modelContext) return { supported: false, registered: 0 };
  const defs = executor.list().map((t) => toWebMcpTool(t, executor));
  try {
    if (typeof modelContext.registerTool === "function") {
      let registered = 0;
      for (const def of defs) {
        try {
          modelContext.registerTool(def);
          registered++;
        } catch {
          // A single rejected definition must not block the rest.
        }
      }
      return { supported: true, registered };
    }
    if (typeof modelContext.provideContext === "function") {
      modelContext.provideContext({ tools: defs });
      return { supported: true, registered: defs.length };
    }
    return { supported: false, registered: 0 };
  } catch (err) {
    return { supported: true, registered: 0, error: String(err?.message ?? err) };
  }
}
