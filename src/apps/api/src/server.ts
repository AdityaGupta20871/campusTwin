import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { MAX_MESSAGE_LENGTH } from "@campus-twin/core";
import { createAzureOpenAIClient, respondToAgentMessage, type AzureChatClient } from "./agent.js";
import { DEFAULT_API_CONFIG, type ApiConfig } from "./config.js";

const ChatRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  hereRoomId: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).optional(),
});

export interface ApiServerOptions {
  config?: ApiConfig;
  azureClient?: AzureChatClient | null;
  logger?: FastifyServerOptions["logger"];
  rateLimitMax?: number;
}

export async function createApiServer({
  config = DEFAULT_API_CONFIG,
  azureClient,
  logger = false,
  rateLimitMax = 60,
}: ApiServerOptions = {}): Promise<FastifyInstance> {
  const client = azureClient === undefined ? createAzureOpenAIClient(config.azureOpenAI) : azureClient;
  const app = Fastify({ logger, bodyLimit: 32 * 1024 });

  await app.register(helmet);
  await app.register(rateLimit, { max: rateLimitMax, timeWindow: "1 minute" });

  app.get("/api/health", async () => ({
    status: "ok",
    provider: client ? "azure-openai" : "deterministic",
  }));

  app.post("/api/agent/chat", async (request, reply) => {
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "INVALID_INPUT",
          message: "Provide a non-empty message of at most 500 characters and an optional valid hereRoomId.",
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      });
    }

    return respondToAgentMessage(parsed.data.message, {
      client,
      deployment: config.azureOpenAI?.deployment,
      hereRoomId: parsed.data.hereRoomId,
      onAzureError: () => request.log.warn("Azure OpenAI request failed; using deterministic fallback."),
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    if (statusCode === 429) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly." } });
    }
    if (statusCode && statusCode < 500) {
      return reply.code(statusCode).send({ error: { code: "INVALID_REQUEST", message: "The request could not be processed." } });
    }
    request.log.error({ err: error }, "Unhandled API error.");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
  });

  return app;
}