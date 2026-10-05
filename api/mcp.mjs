import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCampusTwinMcpServer } from "../src/apps/mcp-server/dist/index.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" });
    response.end("Method Not Allowed");
    return;
  }

  const server = createCampusTwinMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } finally {
    await server.close();
  }
}