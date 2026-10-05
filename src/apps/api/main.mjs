#!/usr/bin/env node
import { createApiServer } from "./dist/server.js";
import { loadApiConfig } from "./dist/config.js";

const config = loadApiConfig(process.env);
const app = await createApiServer({ config, logger: true });

try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info({ address, provider: config.azureOpenAI ? "azure-openai" : "deterministic" }, "Campus Twin API listening.");
} catch (error) {
  app.log.error({ err: error }, "Campus Twin API failed to start.");
  process.exitCode = 1;
}