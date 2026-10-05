import { AzureOpenAI } from "openai";
import type {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import {
  createConciergeAgent,
  createRuntime,
  type AgentReply,
  type AgentResponse,
  type AgentTraceEntry,
  type ToolExecutor,
} from "@campus-twin/core";
import type { AzureOpenAIConfig } from "./config.js";

export const MAX_TOOL_CALLS = 6;

const SYSTEM_PROMPT =
  "You are the Campus Twin workplace concierge. Use the provided tools for building facts, room searches, and directions. Never invent room data. The included building layout is illustrative sample data, not a verified floor plan; emergency routes are not certified life-safety guidance. Answer concisely and disclose when a tool cannot find information.";

export type AzureChatClient = Pick<AzureOpenAI, "chat">;

export type ClientAction =
  | { type: "set_my_location"; roomId: string }
  | { type: "navigate_to"; toRoomId: string; fromRoomId?: string }
  | { type: "show_emergency_exit"; fromRoomId?: string }
  | { type: "show_itinerary"; workflowId?: string; stops?: string[] }
  | { type: "focus_room"; roomId: string };

export interface ChatApiResponse {
  intent: string;
  reply: AgentReply;
  trace: AgentTraceEntry[];
  clientActions: ClientAction[];
  provider: "azure-openai" | "deterministic";
}

export function createAzureOpenAIClient(config: AzureOpenAIConfig | null): AzureChatClient | null {
  if (!config) return null;
  return new AzureOpenAI({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    deployment: config.deployment,
    apiVersion: config.apiVersion,
    timeout: 30_000,
    maxRetries: 1,
  });
}

function toClientActions(response: Pick<AgentResponse, "reply" | "trace">): ClientAction[] {
  const actions: ClientAction[] = [];

  for (const entry of response.trace) {
    if (!entry.ok) continue;
    const { args } = entry;
    if (entry.tool === "set_my_location" && typeof args.roomId === "string") {
      actions.push({ type: "set_my_location", roomId: args.roomId });
    } else if (entry.tool === "get_directions" && typeof args.toRoomId === "string") {
      actions.push({
        type: "navigate_to",
        toRoomId: args.toRoomId,
        ...(typeof args.fromRoomId === "string" && { fromRoomId: args.fromRoomId }),
      });
    } else if (entry.tool === "get_emergency_exit") {
      actions.push({
        type: "show_emergency_exit",
        ...(typeof args.fromRoomId === "string" && { fromRoomId: args.fromRoomId }),
      });
    } else if (entry.tool === "plan_itinerary") {
      const stops = Array.isArray(args.stops) ? args.stops.filter((stop): stop is string => typeof stop === "string") : undefined;
      actions.push({
        type: "show_itinerary",
        ...(typeof args.workflowId === "string" && { workflowId: args.workflowId }),
        ...(stops?.length && { stops }),
      });
    }
  }

  const presentsRoute = actions.some(
    (action) => action.type === "navigate_to" || action.type === "show_emergency_exit" || action.type === "show_itinerary",
  );
  if (response.reply.focus && !presentsRoute) actions.push({ type: "focus_room", roomId: response.reply.focus });
  return actions;
}

function toApiResponse(response: AgentResponse, provider: ChatApiResponse["provider"]): ChatApiResponse {
  return {
    ...response,
    clientActions: toClientActions(response),
    provider,
  };
}

function parseToolArguments(serialized: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function createToolCatalog(executor: ToolExecutor): ChatCompletionTool[] {
  return executor.list().map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

async function completeWithAzure(
  message: string,
  executor: ToolExecutor,
  client: AzureChatClient,
  deployment: string,
): Promise<AgentResponse> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: message },
  ];
  const tools = createToolCatalog(executor);
  const trace: AgentTraceEntry[] = [];
  let toolCallCount = 0;

  for (let round = 0; round < MAX_TOOL_CALLS; round += 1) {
    const completion = await client.chat.completions.create({
      model: deployment,
      messages,
      tools,
      tool_choice: "auto",
    });
    const assistantMessage = completion.choices[0]?.message;
    if (!assistantMessage) throw new Error("Azure OpenAI returned no assistant message.");

    const functionCalls = assistantMessage.tool_calls?.filter(
      (call): call is ChatCompletionMessageFunctionToolCall => call.type === "function",
    ) ?? [];
    if (!functionCalls.length) {
      const text = assistantMessage.content?.trim() || assistantMessage.refusal?.trim();
      if (!text) throw new Error("Azure OpenAI returned an empty response.");
      return { intent: "chat" as AgentResponse["intent"], reply: { text }, trace };
    }

    messages.push({
      role: "assistant",
      content: assistantMessage.content,
      tool_calls: functionCalls,
    });

    for (const call of functionCalls) {
      if (toolCallCount >= MAX_TOOL_CALLS) break;
      const args = parseToolArguments(call.function.arguments);
      const result = await executor.execute(call.function.name, args, { actor: "agent" });
      const summary = result.ok
        ? executor.get(call.function.name)?.summarize?.(result.data, args) ?? "Done"
        : result.error.message;
      trace.push({ tool: call.function.name, args, ok: result.ok, summary });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result.ok ? result.data : { error: result.error }),
      });
      toolCallCount += 1;
    }

    if (toolCallCount >= MAX_TOOL_CALLS) {
      return {
        intent: "rejected",
        reply: { text: `I reached the limit of ${MAX_TOOL_CALLS} tool calls. Please narrow your request and try again.` },
        trace,
      };
    }
  }

  return {
    intent: "rejected",
    reply: { text: `I reached the limit of ${MAX_TOOL_CALLS} tool calls. Please narrow your request and try again.` },
    trace,
  };
}

function createRequestRuntime(hereRoomId?: string) {
  const runtime = createRuntime();
  // Unknown ids are ignored so a stale client location falls back to the default origin.
  if (hereRoomId && runtime.model.hasRoom(hereRoomId)) runtime.session.setHereId(hereRoomId);
  return runtime;
}

async function deterministicResponse(message: string, hereRoomId?: string): Promise<AgentResponse> {
  const runtime = createRequestRuntime(hereRoomId);
  const agent = createConciergeAgent({
    model: runtime.model,
    executor: runtime.executor,
    presentation: false,
    getHereId: runtime.session.getHereId,
  });
  return agent.respond(message);
}

export async function respondToAgentMessage(
  message: string,
  options: {
    client?: AzureChatClient | null;
    deployment?: string;
    hereRoomId?: string;
    onAzureError?: () => void;
  } = {},
): Promise<ChatApiResponse> {
  if (!options.client || !options.deployment) {
    return toApiResponse(await deterministicResponse(message, options.hereRoomId), "deterministic");
  }

  try {
    const runtime = createRequestRuntime(options.hereRoomId);
    const response = await completeWithAzure(message, runtime.executor, options.client, options.deployment);
    return toApiResponse(response, "azure-openai");
  } catch {
    options.onAzureError?.();
    return toApiResponse(await deterministicResponse(message, options.hereRoomId), "deterministic");
  }
}