import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRuntime, type Runtime } from "@campus-twin/core";

export const MCP_SERVER_INFO = {
  name: "campus-twin",
  title: "Campus Twin - Sopra Steria Noida",
  version: "1.0.0",
} as const;

const INSTRUCTIONS =
  "Indoor wayfinding tools for the Sopra Steria Noida office. Call get_building_overview first, use search_rooms to resolve room ids, then get_directions, find_nearest, or plan_itinerary.";

export interface McpServerOptions {
  runtime?: Runtime;
  log?: (message: string) => void;
}

function asStructuredContent(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

export function createCampusTwinMcpServer({ runtime = createRuntime(), log = () => {} }: McpServerOptions = {}): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, { instructions: INSTRUCTIONS });

  for (const tool of runtime.executor.list()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.validator,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          destructiveHint: false,
          idempotentHint: tool.readOnly,
          openWorldHint: false,
        },
      },
      async (args) => {
        const result = await runtime.executor.execute(tool.name, args, { actor: "mcp" });
        if (!result.ok) log(`[tool] ${tool.name} failed: ${result.error.code}`);
        const payload = asStructuredContent(result.ok ? result.data : { error: result.error });
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
          isError: !result.ok,
        };
      },
    );
  }

  return server;
}