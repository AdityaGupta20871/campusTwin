#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRuntime } from "@campus-twin/core";
import { createCampusTwinMcpServer, MCP_SERVER_INFO } from "./dist/index.js";

const log = (message) => process.stderr.write(`${new Date().toISOString()} ${message}\n`);
const runtime = createRuntime();
const server = createCampusTwinMcpServer({ runtime, log });
await server.connect(new StdioServerTransport());
log(`${MCP_SERVER_INFO.name} MCP server ready (${runtime.executor.list().length} tools, stdio)`);