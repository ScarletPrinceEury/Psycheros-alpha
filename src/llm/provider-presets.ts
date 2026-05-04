/**
 * LLM Provider Presets
 *
 * Defines provider types, connection profile types, default configurations,
 * and helper functions for multi-provider LLM connection profiles.
 */

// =============================================================================
// Provider Type
// =============================================================================

/**
 * Supported LLM providers. Each maps to a preset with default configuration.
 * "custom" allows users to paste any OpenAI-compatible endpoint.
 */
export type LLMProvider =
  | "openrouter"
  | "openai"
  | "alibaba"
  | "nanogpt"
  | "groq"
  | "cohere"
  | "mistral"
  | "deepseek"
  | "xai"
  | "fireworks"
  | "siliconflow"
  | "perplexity"
  | "moonshot"
  | "zai"
  | "ollama"
  | "opencompat"
  | "custom";

// =============================================================================
// Connection Profile Type
// =============================================================================

/**
 * A single LLM connection profile. Each profile stores all settings needed
 * to create an LLMClient for chat completions.
 */
export interface LLMConnectionProfile {
  /** Unique identifier (UUID) */
  id: string;
  /** User-friendly name for display in the UI */
  name: string;
  /** Which provider preset this profile is based on */
  provider: LLMProvider;
  /** API endpoint URL */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Model identifier for chat completions */
  model: string;
  /** Lightweight model for auto-titling, summarization, etc. */
  workerModel: string;
  /** Sampling temperature (0-2) */
  temperature: number;
  /** Top-p (nucleus) sampling (0-1) */
  topP: number;
  /** Top-k sampling (0 = disabled) */
  topK: number;
  /** Frequency penalty (-2 to 2) */
  frequencyPenalty: number;
  /** Presence penalty (-2 to 2) */
  presencePenalty: number;
  /** Maximum tokens for response generation */
  maxTokens: number;
  /** Context window size in tokens (used for context budget management) */
  contextLength: number;
  /** Whether chain-of-thought reasoning is enabled */
  thinkingEnabled: boolean;
}

/**
 * Top-level settings containing all connection profiles and the active profile ID.
 */
export interface LLMProfileSettings {
  /** All saved connection profiles */
  profiles: LLMConnectionProfile[];
  /** ID of the currently active profile */
  activeProfileId: string;
}

// =============================================================================
// Provider Preset
// =============================================================================

/**
 * Metadata and defaults for an LLM provider.
 */
export interface LLMProviderPreset {
  /** Display label for the UI */
  label: string;
  /** Default API endpoint URL */
  baseUrl: string;
  /** Default model identifier (pre-filled when creating a profile) */
  defaultModel: string;
  /** Default worker model for lightweight tasks */
  defaultWorkerModel: string;
  /** Whether the provider's default model supports the thinking parameter */
  supportsThinking: boolean;
}

// =============================================================================
// Preset Map
// =============================================================================

/**
 * Preset configurations for each supported provider.
 * These are used to pre-fill form fields when a user selects a provider.
 */
export const LLM_PROVIDER_PRESETS: Record<LLMProvider, LLMProviderPreset> = {
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "glm-4.7",
    defaultWorkerModel: "GLM-4.5-Air",
    supportsThinking: true,
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o",
    defaultWorkerModel: "gpt-4o-mini",
    supportsThinking: false,
  },
  alibaba: {
    label: "Alibaba / Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    defaultModel: "qwen-max",
    defaultWorkerModel: "qwen-turbo",
    supportsThinking: false,
  },
  nanogpt: {
    label: "NanoGPT",
    baseUrl: "https://api.nano-gpt.com/v1/chat/completions",
    defaultModel: "glm-4.7",
    defaultWorkerModel: "GLM-4.5-Air",
    supportsThinking: true,
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.3-70b-versatile",
    defaultWorkerModel: "llama-3.1-8b-instant",
    supportsThinking: true,
  },
  cohere: {
    label: "Cohere",
    baseUrl: "https://api.cohere.ai/compatibility/v1/chat/completions",
    defaultModel: "command-r-plus",
    defaultWorkerModel: "command-r",
    supportsThinking: false,
  },
  mistral: {
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
    defaultModel: "mistral-large-latest",
    defaultWorkerModel: "mistral-small-latest",
    supportsThinking: false,
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-chat",
    defaultWorkerModel: "deepseek-reasoner",
    supportsThinking: true,
  },
  xai: {
    label: "xAI",
    baseUrl: "https://api.x.ai/v1/chat/completions",
    defaultModel: "grok-3",
    defaultWorkerModel: "grok-3-mini",
    supportsThinking: false,
  },
  fireworks: {
    label: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1/chat/completions",
    defaultModel: "fire function call v2",
    defaultWorkerModel: "fire function call v2",
    supportsThinking: false,
  },
  siliconflow: {
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1/chat/completions",
    defaultModel: "Qwen/Qwen3-8B",
    defaultWorkerModel: "Qwen/Qwen3-8B",
    supportsThinking: false,
  },
  perplexity: {
    label: "Perplexity",
    baseUrl: "https://api.perplexity.ai/chat/completions",
    defaultModel: "sonar-pro",
    defaultWorkerModel: "sonar",
    supportsThinking: false,
  },
  moonshot: {
    label: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1/chat/completions",
    defaultModel: "moonshot-v1-128k",
    defaultWorkerModel: "moonshot-v1-8k",
    supportsThinking: false,
  },
  zai: {
    label: "ZAI",
    baseUrl: "https://api.z.ai/api/coding/paas/v4/chat/completions",
    defaultModel: "glm-5-turbo",
    defaultWorkerModel: "glm-4.7",
    supportsThinking: true,
  },
  ollama: {
    label: "Ollama (Local)",
    baseUrl: "http://localhost:11434/v1/chat/completions",
    defaultModel: "llama3",
    defaultWorkerModel: "llama3",
    supportsThinking: false,
  },
  opencompat: {
    label: "OpenAI-Compatible",
    baseUrl: "",
    defaultModel: "",
    defaultWorkerModel: "",
    supportsThinking: false,
  },
  custom: {
    label: "Custom Endpoint",
    baseUrl: "",
    defaultModel: "",
    defaultWorkerModel: "",
    supportsThinking: false,
  },
};

// =============================================================================
// Provider Inference
// =============================================================================

/**
 * Infer the provider type from a base URL.
 * Used during migration to label old settings with the correct provider.
 */
export function inferProvider(baseUrl: string): LLMProvider {
  const url = baseUrl.toLowerCase();

  if (url.includes("openrouter.ai")) return "openrouter";
  if (url.includes("api.openai.com")) return "openai";
  if (url.includes("dashscope.aliyuncs.com")) return "alibaba";
  if (url.includes("nano-gpt.com")) return "nanogpt";
  if (url.includes("groq.com")) return "groq";
  if (url.includes("cohere.ai")) return "cohere";
  if (url.includes("mistral.ai")) return "mistral";
  if (url.includes("deepseek.com")) return "deepseek";
  if (url.includes("x.ai")) return "xai";
  if (url.includes("fireworks.ai")) return "fireworks";
  if (url.includes("siliconflow.cn")) return "siliconflow";
  if (url.includes("perplexity.ai")) return "perplexity";
  if (url.includes("moonshot.cn")) return "moonshot";
  if (url.includes("z.ai")) return "zai";
  if (url.includes("localhost:11434")) return "ollama";

  return "opencompat";
}

/**
 * Infer a display name for a provider based on its base URL.
 * Used during migration to name the migrated profile.
 */
export function inferProviderName(baseUrl: string): string {
  const provider = inferProvider(baseUrl);
  const preset = LLM_PROVIDER_PRESETS[provider];
  return preset.label;
}

// =============================================================================
// Default Profile from Environment
// =============================================================================

/**
 * Create a default LLM connection profile from environment variables.
 * Supports ZAI_* (legacy) env vars.
 */
export function createDefaultProfile(): LLMConnectionProfile {
  const apiKey = Deno.env.get("ZAI_API_KEY") || "";
  const baseUrl = Deno.env.get("ZAI_BASE_URL") || "";
  const model = Deno.env.get("ZAI_MODEL") || "";
  const workerModel = Deno.env.get("ZAI_WORKER_MODEL") || "";

  const provider = baseUrl ? inferProvider(baseUrl) : "openrouter";

  return {
    id: crypto.randomUUID(),
    name: provider !== "custom" ? inferProviderName(baseUrl) : "Default",
    provider,
    baseUrl: baseUrl || LLM_PROVIDER_PRESETS.openrouter.baseUrl,
    apiKey,
    model: model || LLM_PROVIDER_PRESETS[provider].defaultModel,
    workerModel: workerModel || LLM_PROVIDER_PRESETS[provider].defaultWorkerModel,
    temperature: 0.7,
    topP: 1,
    topK: 0,
    frequencyPenalty: 0,
    presencePenalty: 0,
    maxTokens: 4096,
    contextLength: 128000,
    thinkingEnabled: LLM_PROVIDER_PRESETS[provider].supportsThinking,
  };
}
