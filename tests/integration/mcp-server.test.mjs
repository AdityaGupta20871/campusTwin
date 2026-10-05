import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCampusTwinMcpServer, MCP_SERVER_INFO } from "../../src/apps/mcp-server/dist/index.js";
import httpHandler from "../../api/mcp.mjs";

const SERVER = fileURLToPath(new URL("../../src/apps/mcp-server/main.mjs", import.meta.url));

describe("MCP SDK server", () => {
  test("in-memory client discovers headless tools and receives structured results", async (context) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createCampusTwinMcpServer();
    const client = new Client({ name: "campus-twin-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    context.after(async () => {
      await Promise.allSettled([client.close(), server.close()]);
    });

    assert.equal(client.getServerVersion()?.name, MCP_SERVER_INFO.name);
    const { tools } = await client.listTools();
    const directions = tools.find((tool) => tool.name === "get_directions");
    assert.ok(directions);
    assert.equal(directions.annotations?.readOnlyHint, true);
    assert.ok(!tools.some((tool) => tool.name === "navigate_to"), "presentation tools need a browser");

    const result = await client.callTool({ name: "get_directions", arguments: { toRoomId: "3-it" } });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.to.id, "3-it");
    assert.equal(JSON.parse(result.content[0].text).via, "lift");

    const badRoom = await client.callTool({ name: "get_room", arguments: { roomId: "nope" } });
    assert.equal(badRoom.isError, true);
    assert.equal(badRoom.structuredContent.error.code, "NOT_FOUND");

    const invalidInput = await client.callTool({ name: "get_room", arguments: { roomId: 17 } });
    assert.equal(invalidInput.isError, true);
  });

  test("SDK stdio client completes handshake, lists tools, and calls a tool", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      stderr: "pipe",
    });
    const client = new Client({ name: "campus-twin-stdio-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion()?.name, MCP_SERVER_INFO.name);
      const { tools } = await client.listTools();
      assert.ok(tools.length >= 10);
      const result = await client.callTool({ name: "find_nearest", arguments: { type: "firstaid" } });
      assert.equal(result.structuredContent.nearest.id, "g-firstaid");
    } finally {
      await client.close();
    }
  });

  test("stateless HTTP endpoint exposes headless tools for a remote client", async (context) => {
    const httpServer = createServer(httpHandler);
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const endpoint = new URL(`http://127.0.0.1:${httpServer.address().port}/api/mcp`);
    const client = new Client({ name: "campus-twin-http-test", version: "1.0.0" });
    context.after(async () => {
      await client.close();
      await new Promise((resolve) => httpServer.close(resolve));
    });

    const unsupported = await fetch(endpoint);
    assert.equal(unsupported.status, 405);
    await client.connect(new StreamableHTTPClientTransport(endpoint));
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === "get_directions"));
    assert.ok(!tools.some((tool) => tool.name === "navigate_to"));
    const result = await client.callTool({ name: "get_directions", arguments: { toRoomId: "3-it" } });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.via, "lift");
    assert.equal(result.structuredContent.to.id, "3-it");
  });
});
