import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createApiServer, DEFAULT_API_CONFIG, loadApiConfig, MAX_TOOL_CALLS } from "../../src/apps/api/dist/index.js";

const azureConfig = {
  ...DEFAULT_API_CONFIG,
  azureOpenAI: {
    endpoint: "https://sample-resource.openai.azure.com",
    apiKey: "test-key",
    deployment: "test-deployment",
    apiVersion: "2024-10-21",
  },
};

const functionCall = (id) => ({
  id,
  type: "function",
  function: { name: "get_building_overview", arguments: "{}" },
});

describe("agent API", () => {
  test("health and chat work offline without Azure credentials", async () => {
    const app = await createApiServer({ logger: false });
    try {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      assert.equal(health.statusCode, 200);
      assert.deepEqual(health.json(), { status: "ok", provider: "deterministic" });
      assert.equal(health.headers["x-content-type-options"], "nosniff");

      const response = await app.inject({ method: "POST", url: "/api/agent/chat", payload: { message: "Where is the IT helpdesk?" } });
      const body = response.json();
      assert.equal(response.statusCode, 200);
      assert.equal(body.provider, "deterministic");
      assert.equal(body.intent, "navigate");
      assert.ok(body.trace.some((entry) => entry.tool === "get_directions"));
      assert.ok(body.clientActions.some((action) => action.type === "navigate_to"));
    } finally {
      await app.close();
    }
  });

  test("routes from the caller's location and rejects malformed location ids", async () => {
    const app = await createApiServer({ logger: false });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/agent/chat",
        payload: { message: "Where is the IT helpdesk?", hereRoomId: "2-meet-1" },
      });
      const directions = response.json().trace.find((entry) => entry.tool === "get_directions");
      assert.equal(response.statusCode, 200);
      assert.match(directions.summary, /Meeting Room 2\.01/);

      const invalid = await app.inject({ method: "POST", url: "/api/agent/chat", payload: { message: "hi", hereRoomId: "<script>" } });
      assert.equal(invalid.statusCode, 400);
    } finally {
      await app.close();
    }
  });

  test("validates empty, oversized, and unknown request fields", async () => {
    const app = await createApiServer({ logger: false });
    try {
      for (const payload of [
        { message: " " },
        { message: "x".repeat(501) },
        { message: "hello", extra: true },
      ]) {
        const response = await app.inject({ method: "POST", url: "/api/agent/chat", payload });
        assert.equal(response.statusCode, 400);
        assert.equal(response.json().error.code, "INVALID_INPUT");
      }
    } finally {
      await app.close();
    }
  });

  test("uses Azure function calling with the shared tool catalog", async () => {
    const requests = [];
    const client = {
      chat: {
        completions: {
          create: async (request) => {
            requests.push(request);
            if (requests.length === 1) {
              return { choices: [{ message: { role: "assistant", content: null, tool_calls: [functionCall("call-1")] } }] };
            }
            return { choices: [{ message: { role: "assistant", content: "The building has five floors.", tool_calls: null } }] };
          },
        },
      },
    };
    const app = await createApiServer({ config: azureConfig, azureClient: client, logger: false });
    try {
      const response = await app.inject({ method: "POST", url: "/api/agent/chat", payload: { message: "How many floors?" } });
      const body = response.json();
      assert.equal(body.provider, "azure-openai");
      assert.equal(body.intent, "chat");
      assert.equal(body.reply.text, "The building has five floors.");
      assert.equal(body.trace[0].tool, "get_building_overview");
      assert.ok(requests[0].tools.some((tool) => tool.function.name === "get_building_overview"));
      const assistantToolCall = requests[1].messages.find((message) => message.role === "assistant").tool_calls[0];
      const toolResult = requests[1].messages.find((message) => message.role === "tool");
      assert.equal(assistantToolCall.id, "call-1");
      assert.equal(toolResult.tool_call_id, "call-1");
      assert.equal(requests.length, 2);
    } finally {
      await app.close();
    }
  });

  test("falls back deterministically when Azure is unavailable", async () => {
    const client = { chat: { completions: { create: async () => { throw new Error("simulated upstream failure"); } } } };
    const app = await createApiServer({ config: azureConfig, azureClient: client, logger: false });
    try {
      const response = await app.inject({ method: "POST", url: "/api/agent/chat", payload: { message: "Nearest restroom" } });
      const body = response.json();
      assert.equal(response.statusCode, 200);
      assert.equal(body.provider, "deterministic");
      assert.equal(body.intent, "navigate");
      assert.ok(body.trace.some((entry) => entry.tool === "find_nearest"));
    } finally {
      await app.close();
    }
  });

  test("caps tool executions at six per chat", async () => {
    let requestCount = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            requestCount += 1;
            return { choices: [{ message: { role: "assistant", content: null, tool_calls: [functionCall(`call-${requestCount}`)] } }] };
          },
        },
      },
    };
    const app = await createApiServer({ config: azureConfig, azureClient: client, logger: false });
    try {
      const response = await app.inject({ method: "POST", url: "/api/agent/chat", payload: { message: "Summarize the building" } });
      const body = response.json();
      assert.equal(body.intent, "rejected");
      assert.equal(body.trace.length, MAX_TOOL_CALLS);
      assert.equal(requestCount, MAX_TOOL_CALLS);
    } finally {
      await app.close();
    }
  });

  test("rate limits requests", async () => {
    const app = await createApiServer({ logger: false, rateLimitMax: 1 });
    try {
      assert.equal((await app.inject({ method: "GET", url: "/api/health" })).statusCode, 200);
      const limited = await app.inject({ method: "GET", url: "/api/health" });
      assert.equal(limited.statusCode, 429);
      assert.equal(limited.json().error.code, "RATE_LIMITED");
    } finally {
      await app.close();
    }
  });

  test("requires a complete Azure configuration and accepts blank placeholders", () => {
    assert.equal(loadApiConfig({ AZURE_OPENAI_API_KEY: "", AZURE_OPENAI_ENDPOINT: "" }).azureOpenAI, null);
    assert.throws(() => loadApiConfig({ AZURE_OPENAI_API_KEY: "test-key" }), /requires an endpoint, API key, and deployment/);
    assert.equal(loadApiConfig({ HOST: "0.0.0.0", PORT: "8080" }).port, 8080);
  });
});