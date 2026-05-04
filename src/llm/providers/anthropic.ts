/**
 * Anthropic Messages API Provider Adapter
 *
 * Handles the Anthropic Claude Messages API, which differs from OpenAI:
 * - Auth via `x-api-key` header (not Bearer token)
 * - System prompt is a separate top-level field, not in the messages array
 * - Messages must strictly alternate user/assistant roles
 * - Thinking via `thinking` parameter with `budget_tokens`
 * - Streaming uses `content_block_delta` events
 * - Tool use via `tool_use` content blocks
 */

import type { ToolDefinition } from "../../types.ts";
import type { ChatMessage, StreamChunk } from "../types.ts";
import type { LLMConnectionProfile } from "../provider-presets.ts";
import type { ProviderAdapter, ProviderRequest } from "./types.ts";

/**
 * Accumulator for Anthropic streaming state.
 */
export interface AnthropicAccumulator {
  /** Index of the current content block being streamed */
  currentBlockIndex: number;
  /** Type of the current content block (text, thinking, tool_use) */
  currentBlockType: string;
  /** Accumulated tool call data: tool_use block index -> { id, name, arguments } */
  toolCalls: Map<number, { id: string; name: string; arguments: string }>;
  /** Whether we've seen the initial message_start event */
  messageStarted: boolean;
  /** The stop_reason from message_delta event */
  stopReason: string | null;
}

/**
 * Merge consecutive same-role messages to satisfy Anthropic's alternation requirement.
 * System messages are extracted and returned separately.
 */
function extractAndMergeMessages(messages: ChatMessage[]): {
  system: string;
  merged: Array<{ role: string; content: unknown[] }>;
} {
  const systemParts: string[] = [];
  const roleOrder: string[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else {
      const mappedRole = msg.role === "assistant" ? "assistant" : "user";
      if (roleOrder.length === 0 || roleOrder[roleOrder.length - 1] !== mappedRole) {
        roleOrder.push(mappedRole);
      }
    }
  }

  // Build content blocks grouped by consecutive role
  const nonSystemMessages = messages.filter((m) => m.role !== "system");
  const merged: Array<{ role: string; content: unknown[] }> = [];

  for (const msg of nonSystemMessages) {
    const role = msg.role === "assistant" ? "assistant" : "user";

    if (merged.length > 0 && merged[merged.length - 1].role === role) {
      // Merge into existing block
      merged[merged.length - 1].content.push({ type: "text", text: msg.content });
    } else {
      merged.push({ role, content: [{ type: "text", text: msg.content }] });
    }
  }

  // Ensure conversation starts with "user" (Anthropic requirement)
  if (merged.length > 0 && merged[0].role === "assistant") {
    merged.unshift({ role: "user", content: [{ type: "text", text: "(continue)" }] });
  }

  return {
    system: systemParts.join("\n\n"),
    merged,
  };
}

/**
 * Transform Psycheros tool definitions into Anthropic tool format.
 */
function transformTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description || "",
    input_schema: tool.function.parameters || { type: "object", properties: {} },
  }));
}

/**
 * Transform Psycheros tool result messages into Anthropic tool_result format.
 */
function transformToolResults(messages: ChatMessage[]): Array<{ role: string; content: unknown[] }> {
  const results: Array<{ role: string; content: unknown[] }> = [];
  const pending = messages.filter((m) => m.role === "tool");

  for (const msg of pending) {
    let content: unknown;
    try {
      content = JSON.parse(msg.content);
    } catch {
      content = msg.content;
    }

    results.push({
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: msg.tool_call_id || "",
        content: typeof content === "string" ? content : JSON.stringify(content),
      }],
    });
  }

  return results;
}

/**
 * Adapter for the Anthropic Messages API.
 */
export const anthropicAdapter: ProviderAdapter = {
  buildRequest(
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    profile: LLMConnectionProfile,
    options?: { temperature?: number; maxTokens?: number; thinkingEnabled?: boolean },
  ): ProviderRequest {
    const { system, merged } = extractAndMergeMessages(messages);
    const toolResults = transformToolResults(messages);

    // Interleave tool results back into the merged message sequence at the right positions.
    // Tool results follow assistant messages that contained tool_use blocks.
    // For simplicity, we append tool results as user-role messages.
    const allMessages = [...merged, ...toolResults];

    const body: Record<string, unknown> = {
      model: profile.model,
      messages: allMessages,
      stream: true,
      max_tokens: options?.maxTokens || profile.maxTokens || 4096,
    };

    if (system) {
      body.system = system;
    }

    // Thinking configuration
    const thinkingEnabled = options?.thinkingEnabled ?? profile.thinkingEnabled;
    if (thinkingEnabled) {
      body.thinking = {
        type: "enabled",
        budget_tokens: 10000,
      };
    }

    if (tools && tools.length > 0) {
      body.tools = transformTools(tools);
      body.tool_choice = { type: "auto" };
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    } else if (profile.temperature !== undefined) {
      body.temperature = profile.temperature;
    }

    if (profile.topP !== undefined) {
      body.top_p = profile.topP;
    }

    // Build URL — append /messages to baseUrl if not already present
    let url = profile.baseUrl.replace(/\/+$/, "");
    if (!url.endsWith("/messages")) {
      url += "/messages";
    }

    // Anthropic version header
    const anthropicVersion = profile.provider === "anthropic"
      ? "2023-06-01"
      : "2023-06-01";

    return {
      url,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": profile.apiKey,
        "anthropic-version": anthropicVersion,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body,
    };
  },

  parseStreamChunk(data: string, accumulator: unknown): StreamChunk[] {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return [];
    }

    const acc = accumulator as AnthropicAccumulator;
    const type = event.type as string;
    const results: StreamChunk[] = [];

    switch (type) {
      case "message_start": {
        acc.messageStarted = true;
        // Extract model info if needed
        const message = event.message as Record<string, unknown> | undefined;
        if (message) {
          const usage = message.usage as Record<string, unknown> | undefined;
          if (usage) {
            console.log(`[LLM:Anthropic] Usage: input=${usage.input_tokens}, output=${usage.output_tokens}`);
          }
        }
        return [];
      }

      case "content_block_start": {
        const block = event.content_block as Record<string, unknown> | undefined;
        if (block) {
          acc.currentBlockIndex = event.index as number;
          acc.currentBlockType = block.type as string;

          if (block.type === "tool_use") {
            const idx = event.index as number;
            acc.toolCalls.set(idx, {
              id: block.id as string || "",
              name: block.name as string || "",
              arguments: "",
            });
          }
        }
        return [];
      }

      case "content_block_delta": {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (!delta) return [];

        if (delta.type === "text_delta") {
          results.push({ type: "content", content: delta.text as string || "" });
        } else if (delta.type === "thinking_delta") {
          results.push({ type: "thinking", content: delta.thinking as string || "" });
        } else if (delta.type === "input_json_delta") {
          // Tool call argument fragment
          const idx = event.index as number;
          const tc = acc.toolCalls.get(idx);
          if (tc) {
            tc.arguments += (delta.partial_json as string) || "";
          }
        }
        return results;
      }

      case "content_block_stop": {
        const idx = event.index as number;
        // If this was a tool_use block, emit the accumulated tool call
        if (acc.currentBlockType === "tool_use" || acc.toolCalls.has(idx)) {
          const tc = acc.toolCalls.get(idx);
          if (tc && tc.id && tc.name) {
            results.push({
              type: "tool_call",
              toolCall: {
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: tc.arguments },
              },
            });
            acc.toolCalls.delete(idx);
          }
        }
        return results;
      }

      case "message_delta": {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta) {
          acc.stopReason = (delta.stop_reason as string) || "end_turn";
        }
        return [];
      }

      case "message_stop": {
        results.push({ type: "done", finishReason: acc.stopReason || "end_turn" });
        return results;
      }

      case "ping":
      case "error": {
        if (type === "error") {
          const error = event.error as Record<string, unknown> | undefined;
          throw new Error(
            `Anthropic API error: ${(error?.message as string) || JSON.stringify(event)}`,
          );
        }
        return [];
      }

      default:
        return [];
    }
  },

  parseResponse(json: unknown): StreamChunk[] {
    const resp = json as Record<string, unknown>;
    const results: StreamChunk[] = [];

    const content = resp.content as Array<Record<string, unknown>> | undefined;
    if (content) {
      for (const block of content) {
        if (block.type === "text") {
          results.push({ type: "content", content: block.text as string || "" });
        } else if (block.type === "thinking") {
          results.push({ type: "thinking", content: block.thinking as string || "" });
        } else if (block.type === "tool_use") {
          results.push({
            type: "tool_call",
            toolCall: {
              id: block.id as string,
              type: "function",
              function: {
                name: block.name as string,
                arguments: typeof block.input === "string"
                  ? block.input
                  : JSON.stringify(block.input || {}),
              },
            },
          });
        }
      }
    }

    results.push({
      type: "done",
      finishReason: (resp.stop_reason as string) || "end_turn",
    });

    return results;
  },

  createAccumulator(): unknown {
    return {
      currentBlockIndex: -1,
      currentBlockType: "",
      toolCalls: new Map<number, { id: string; name: string; arguments: string }>(),
      messageStarted: false,
      stopReason: null,
    };
  },
};
