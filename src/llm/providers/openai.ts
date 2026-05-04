/**
 * OpenAI-Compatible Provider Adapter
 *
 * Handles the standard OpenAI chat completions protocol used by OpenRouter,
 * OpenAI, Alibaba/Qwen, NanoGPT, and any OpenAI-compatible endpoint.
 * This adapter extracts the existing logic from LLMClient into a
 * standalone adapter with zero behavioral change.
 */

import type { ToolDefinition } from "../../types.ts";
import type { ChatMessage, StreamChunk } from "../types.ts";
import type { LLMConnectionProfile } from "../provider-presets.ts";
import type { ProviderAdapter, ProviderRequest } from "./types.ts";

/**
 * Accumulator for building tool calls from streamed chunks.
 */
export interface OpenAIToolCallAccumulator {
  /** Map of tool call index to accumulated data */
  toolCalls: Map<number, { id: string; name: string; arguments: string }>;
  /** Whether we've logged which reasoning field is in use */
  loggedReasoningField: boolean;
}

/**
 * Adapter for the OpenAI chat completions protocol.
 */
export const openaiAdapter: ProviderAdapter = {
  buildRequest(
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    profile: LLMConnectionProfile,
    options?: { temperature?: number; maxTokens?: number; thinkingEnabled?: boolean },
  ): ProviderRequest {
    const body: Record<string, unknown> = {
      model: options?.maxTokens
        ? profile.workerModel || profile.model
        : profile.model,
      messages,
      stream: true,
    };

    // Thinking: only "custom" providers (e.g. Z.ai) send this parameter
    if (options?.thinkingEnabled ?? profile.thinkingEnabled) {
      if (profile.provider === "custom") {
        body.thinking = { type: "enabled" };
      }
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    // Per-call options override profile defaults
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    } else if (profile.temperature !== undefined) {
      body.temperature = profile.temperature;
    }

    if (options?.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    } else if (profile.maxTokens !== undefined) {
      body.max_tokens = profile.maxTokens;
    }

    if (profile.topP !== undefined) {
      body.top_p = profile.topP;
    }

    if (profile.topK !== undefined && profile.topK > 0) {
      body.top_k = profile.topK;
    }

    if (profile.frequencyPenalty !== undefined) {
      body.frequency_penalty = profile.frequencyPenalty;
    }

    if (profile.presencePenalty !== undefined) {
      body.presence_penalty = profile.presencePenalty;
    }

    return {
      url: profile.baseUrl,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
      },
      body,
    };
  },

  parseStreamChunk(data: string, accumulator: unknown): StreamChunk[] {
    if (data === "[DONE]") {
      return [{ type: "done", finishReason: "stop" }];
    }

    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return [];
    }

    // Detect upstream error responses embedded in SSE stream
    if (chunk.error && typeof chunk.error === "object") {
      throw new Error(
        `Upstream API error: ${(chunk.error as Record<string, unknown>).message || JSON.stringify(chunk.error)}`,
      );
    }

    const acc = accumulator as OpenAIToolCallAccumulator;
    const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) return [];

    const results: StreamChunk[] = [];

    for (const choice of choices) {
      const delta = choice.delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      // Thinking/reasoning content
      const reasoning = (delta.reasoning_content as string | undefined) ||
        (delta.reasoning as string | undefined);
      if (reasoning) {
        if (!acc.loggedReasoningField) {
          const field = (delta.reasoning_content ? "reasoning_content" : "reasoning");
          console.log(`[LLM:OpenAI] Detected reasoning via delta.${field}`);
          acc.loggedReasoningField = true;
        }
        results.push({ type: "thinking", content: reasoning });
      }

      // Main content
      if (typeof delta.content === "string" && delta.content.length > 0) {
        results.push({ type: "content", content: delta.content });
      }

      // Tool calls (accumulate)
      const toolCallDeltas = delta.tool_calls as Array<Record<string, unknown>> | undefined;
      if (toolCallDeltas) {
        for (const tcd of toolCallDeltas) {
          const index = tcd.index as number;
          let accEntry = acc.toolCalls.get(index);
          if (!accEntry) {
            accEntry = { id: "", name: "", arguments: "" };
            acc.toolCalls.set(index, accEntry);
          }
          if (typeof tcd.id === "string") accEntry.id = tcd.id;
          const fn = tcd.function as Record<string, unknown> | undefined;
          if (fn) {
            if (typeof fn.name === "string") accEntry.name = fn.name;
            if (typeof fn.arguments === "string") accEntry.arguments += fn.arguments;
          }
        }
      }

      // Finish reason — emit accumulated tool calls
      const finishReason = choice.finish_reason as string | null | undefined;
      if (finishReason === "tool_calls") {
        for (const [, accEntry] of acc.toolCalls) {
          if (accEntry.id && accEntry.name) {
            results.push({
              type: "tool_call",
              toolCall: {
                id: accEntry.id,
                type: "function",
                function: { name: accEntry.name, arguments: accEntry.arguments },
              },
            });
          }
        }
        acc.toolCalls.clear();
      }

      if (finishReason) {
        results.push({ type: "done", finishReason });
      }
    }

    return results;
  },

  parseResponse(json: unknown): StreamChunk[] {
    const resp = json as Record<string, unknown>;
    const choices = resp.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) return [];

    const choice = choices[0];
    const message = choice.message as Record<string, unknown> | undefined;
    if (!message) return [];

    const results: StreamChunk[] = [];

    const reasoning = (message.reasoning_content as string | undefined) ||
      (message.reasoning as string | undefined);
    if (reasoning) {
      results.push({ type: "thinking", content: reasoning });
    }

    if (typeof message.content === "string") {
      results.push({ type: "content", content: message.content });
    }

    const toolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        const fn = tc.function as Record<string, unknown>;
        results.push({
          type: "tool_call",
          toolCall: {
            id: tc.id as string,
            type: "function",
            function: { name: fn.name as string, arguments: fn.arguments as string },
          },
        });
      }
    }

    results.push({
      type: "done",
      finishReason: (choice.finish_reason as string) || "stop",
    });

    return results;
  },

  createAccumulator(): unknown {
    return {
      toolCalls: new Map<number, { id: string; name: string; arguments: string }>(),
      loggedReasoningField: false,
    };
  },
};
