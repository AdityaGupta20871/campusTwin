import { z } from "zod";

const EnvironmentSchema = z.object({
  host: z.string().trim().min(1).default("127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  endpoint: z.string().url().refine((value) => new URL(value).protocol === "https:", "Azure endpoint must use HTTPS.").optional(),
  apiKey: z.string().min(1).optional(),
  deployment: z.string().min(1).optional(),
  apiVersion: z.string().min(1).default("2024-10-21"),
  openAIKey: z.string().min(1).optional(),
  openAIModel: z.string().min(1).optional(),
});

export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

export interface ApiConfig {
  host: string;
  port: number;
  azureOpenAI: AzureOpenAIConfig | null;
  openAI: { apiKey: string; model: string } | null;
}

function optionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function loadApiConfig(environment: Record<string, string | undefined>): ApiConfig {
  const parsed = EnvironmentSchema.parse({
    host: optionalValue(environment.HOST),
    port: optionalValue(environment.PORT),
    endpoint: optionalValue(environment.AZURE_OPENAI_ENDPOINT),
    apiKey: optionalValue(environment.AZURE_OPENAI_API_KEY),
    deployment: optionalValue(environment.AZURE_OPENAI_DEPLOYMENT),
    apiVersion: optionalValue(environment.AZURE_OPENAI_API_VERSION),
    openAIKey: optionalValue(environment.OPENAI_API_KEY),
    openAIModel: optionalValue(environment.OPENAI_MODEL),
  });

  const azureValues = [parsed.endpoint, parsed.apiKey, parsed.deployment];
  const azureConfigured = azureValues.every((value): value is string => Boolean(value));
  if (azureValues.some(Boolean) && !azureConfigured) {
    throw new Error("Azure OpenAI requires an endpoint, API key, and deployment together.");
  }
  if (Boolean(parsed.openAIKey) !== Boolean(parsed.openAIModel)) {
    throw new Error("OpenAI requires an API key and model together.");
  }
  if (azureConfigured && parsed.openAIKey) {
    throw new Error("Configure either OpenAI or Azure OpenAI, not both.");
  }

  return {
    host: parsed.host,
    port: parsed.port,
    azureOpenAI: azureConfigured
      ? {
          endpoint: parsed.endpoint!,
          apiKey: parsed.apiKey!,
          deployment: parsed.deployment!,
          apiVersion: parsed.apiVersion,
        }
      : null,
    openAI: parsed.openAIKey && parsed.openAIModel
      ? { apiKey: parsed.openAIKey, model: parsed.openAIModel }
      : null,
  };
}

export const DEFAULT_API_CONFIG = loadApiConfig({});