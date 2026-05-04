/**
 * Google Gemini Provider Adapter
 *
 * Handles the Google Gemini Generative Language API, which differs from OpenAI:
 * - Auth via `x-goog-api-key` header (not Bearer token)
 * - System instruction is a separate `systemInstruction` field
 * - Assistant role is mapped to "model"
 * - Thinking via `generationConfig.thinkingConfig`
 * - Streaming SSE wraps JSON in `data:` lines with `candidates[].content.parts[]`
 * - Thought signatures must be preserved for reasoning continuity across turns
 */

import type { ToolDefinition } from "../../types.ts";
import type { ChatMessage, StreamChunk } from "../types.ts";
import type { LLMConnectionProfile } from "../provider-presets.ts";
import type { ProviderAdapter, ProviderRequest } from "./types.ts";

/**
 * Accumulator for Gemini streaming state.
 */
export interface GeminiAccumulator {
  /** Accumulated tool call data: function call name -> arguments string */
  toolCalls: Map<string, { name: string; arguments: string }>;
  /** Whether we've seen any content yet */
  hasContent: boolean;
  /** Finish reason from the last chunk */
  finishReason: string | null;
  /** Thought signatures to pass back on subsequent turns */
  thoughtSignatures: Array<{ thoughtSignature: string; thoughtProcess: string }>;
}

/**
 * Transform a Psycheros message role to Gemini's role format.
 */
function mapRole(role: string): string {
  if (role === "assistant") return "model";
  if (role === "tool") return "user";
  return "user";
}

/**
 * Build a Gemini content part from a Psycheros message.
 */
function messageToParts(msg: ChatMessage): Array<Record<string, unknown>> {
  // Try to detect image content (base64 data URLs in message content)
  const parts: Array<Record<string, unknown>> = [];

  // For tool result messages, wrap in functionResponse format
  if (msg.role === "tool") {
    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(msg.content);
    } catch {
      parsedContent = msg.content;
    }

    parts.push({
      functionResponse: {
        name: msg.tool_call_id || "unknown",
        response: typeof parsedContent === "object" ? parsedContent : { result: parsedContent },
      },
    });
    return parts;
  }

  // Regular text content
  parts.push({ text: msg.content });
  return parts;
}

/**
 * Transform Psycheros tool definitions into Gemini function declarations.
 */
function transformTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description || "",
    parameters: tool.function.parameters || { type: "object", properties: {} },
  }));
}

/**
 * Adapter for the Google Gemini API.
 */
export const geminiAdapter: ProviderAdapter = {
  buildRequest(
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    profile: LLMConnectionProfile,
    options?: { temperature?: number; maxTokens?: number; thinkingEnabled?: boolean },
  ): ProviderRequest {
    // Extract system messages
    const systemParts: string[] = [];
    const nonSystemMessages: ChatMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemParts.push(msg.content);
      } else {
        nonSystemMessages.push(msg);
      }
    }

    // Build Gemini contents array
    const contents = nonSystemMessages.map((msg) => ({
      role: mapRole(msg.role),
      parts: messageToParts(msg),
    }));

    // Ensure contents starts with "user" role
    if (contents.length > 0 && contents[0].role === "model") {
      contents.unshift({ role: "user", parts: [{ text: "(continue)" }] });
    }

    const generationConfig: Record<string, unknown> = {};

    const thinkingEnabled = options?.thinkingEnabled ?? profile.thinkingEnabled;
    if (thinkingEnabled) {
      // Use thinkingLevel for broader Gemini compatibility
      generationConfig.thinkingConfig = {
        thinkingLevel: "think-1",
      };
    }

    if (options?.temperature !== undefined) {
      generationConfig.temperature = options.temperature;
    } else if (profile.temperature !== undefined) {
      generationConfig.temperature = profile.temperature;
    }

    if (options?.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = options.maxTokens;
    } else if (profile.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = profile.maxTokens;
    }

    if (profile.topP !== undefined) {
      generationConfig.topP = profile.topP;
    }

    if (profile.topK !== undefined && profile.topK > 0) {
      generationConfig.topK = profile.topK;
    }

    const body: Record<string, unknown> = {
      contents,
    };

    if (systemParts.length > 0) {
      body.systemInstruction = {
        parts: [{ text: systemParts.join("\n\n") }],
      };
    }

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    if (tools && tools.length > 0) {
      body.tools = [{ functionDeclarations: transformTools(tools) }];
    }

    // Build URL: {baseUrl}/models/{model}:streamGenerateContent?alt=sse
    let baseUrl = profile.baseUrl.replace(/\/+$/, "");
    // Strip trailing /v1beta or /v1 if present (we'll add it in the path)
    if (baseUrl.endsWith("/v1beta") || baseUrl.endsWith("/v1")) {
      baseUrl = baseUrl.substring(0, baseUrl.lastIndexOf("/"));
    }
    const url = `${baseUrl}/models/${profile.model}:streamGenerateContent?alt=sse`;

    return {
      url,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": profile.apiKey,
      },
      body,
    };
  },

  parseStreamChunk(data: string, accumulator: unknown): StreamChunk[] {
    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return [];
    }

    const acc = accumulator as GeminiAccumulator;
    const results: StreamChunk[] = [];

    // Gemini streaming wraps responses with candidates array
    const candidates = chunk.candidates as Array<Record<string, unknown>> | undefined;
    if (!candidates || candidates.length === 0) return [];

    for (const candidate of candidates) {
      const content = candidate.content as Record<string, unknown> | undefined;
      if (!content) continue;

      const parts = content.parts as Array<Record<string, unknown>> | undefined;
      if (!parts) continue;

      for (const part of parts) {
        // Regular text content
        if (typeof part.text === "string") {
          acc.hasContent = true;
          results.push({ type: "content", content: part.text });
        }

        // Thinking/thought content (Gemini 2.5+)
        if (typeof part.thought === "boolean" && part.thought && typeof part.text === "string") {
          // Already emitted as content above if text exists, but mark as thinking
          // Gemini includes thought:true on parts that are thinking blocks
        }

        // Function call (tool use)
        if (part.functionCall) {
          const fc = part.functionCall as Record<string, unknown>;
          const name = fc.name as string;
          const args = typeof fc.args === "string"
            ? fc.args
            : JSON.stringify(fc.args || {});
          acc.toolCalls.set(name, { name, arguments: args });
          results.push({
            type: "tool_call",
            toolCall: {
              id: `call_${name}`,
              type: "function",
              function: { name, arguments: args },
            },
          });
        }

        // Thought signature (for continuity across turns)
        if (part.thoughtSignature) {
          acc.thoughtSignatures.push({
            thoughtSignature: part.thoughtSignature as string,
            thoughtProcess: (part.thoughtProcess as string) || "",
          });
        }
      }

      // Finish reason
      const finishReason = candidate.finishReason as string | undefined;
      if (finishReason) {
        acc.finishReason = finishReason;
      }
    }

    return results;
  },

  parseResponse(json: unknown): StreamChunk[] {
    const resp = json as Record<string, unknown>;
    const results: StreamChunk[] = [];

    const candidates = resp.candidates as Array<Record<string, unknown>> | undefined;
    if (!candidates || candidates.length === 0) {
      results.push({ type: "done", finishReason: "stop" });
      return results;
    }

    for (const candidate of candidates) {
      const content = candidate.content as Record<string, unknown> | undefined;
      if (!content) continue;

      const parts = content.parts as Array<Record<string, unknown>> | undefined;
      if (!parts) continue;

      for (const part of parts) {
        if (typeof part.text === "string") {
          if (typeof part.thought === "boolean" && part.thought) {
            results.push({ type: "thinking", content: part.text });
          } else {
            results.push({ type: "content", content: part.text });
          }
        }

        if (part.functionCall) {
          const fc = part.functionCall as Record<string, unknown>;
          const name = fc.name as string;
          const args = typeof fc.args === "string"
            ? fc.args
            : JSON.stringify(fc.args || {});
          results.push({
            type: "tool_call",
            toolCall: {
              id: `call_${name}`,
              type: "function",
              function: { name, arguments: args },
            },
          });
        }
      }

      const finishReason = candidate.finishReason as string | undefined;
      if (finishReason) {
        results.push({ type: "done", finishReason });
      }
    }

    if (!results.some((r) => r.type === "done")) {
      results.push({ type: "done", finishReason: "stop" });
    }

    return results;
  },

  createAccumulator(): unknown {
    return {
      toolCalls: new Map<string, { name: string; arguments: string }>(),
      hasContent: false,
      finishReason: null,
      thoughtSignatures: [],
    };
  },
};
