/**
 * Provider Adapter Types
 *
 * Defines the interface that each LLM provider adapter must implement.
 * Adapters handle the transformation between Psycheros's internal message
 * format and the provider's native API format, both for outgoing requests
 * and incoming streaming responses.
 */

import type { ToolDefinition } from "../../types.ts";
import type { ChatMessage, StreamChunk } from "../types.ts";
import type { LLMConnectionProfile } from "../provider-presets.ts";

/**
 * Result of building a native API request from a provider adapter.
 */
export interface ProviderRequest {
  /** Full URL for the API endpoint */
  url: string;
  /** HTTP headers (including auth) */
  headers: Record<string, string>;
  /** Request body in the provider's native format */
  body: unknown;
}

/**
 * Interface for a provider-specific adapter.
 *
 * Each adapter transforms outgoing messages into the provider's native format
 * and parses streaming SSE chunks back into Psycheros's StreamChunk format.
 * The LLMClient handles the HTTP plumbing; adapters handle format differences.
 */
export interface ProviderAdapter {
  /**
   * Transform messages and options into the provider's native request format.
   *
   * @param messages - Conversation messages in Psycheros format
   * @param tools - Optional tool definitions
   * @param profile - The connection profile (baseUrl, model, apiKey, etc.)
   * @param options - Per-request overrides (temperature, maxTokens, thinking)
   */
  buildRequest(
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    profile: LLMConnectionProfile,
    options?: { temperature?: number; maxTokens?: number; thinkingEnabled?: boolean },
  ): ProviderRequest;

  /**
   * Parse a single SSE "data:" line into zero or more StreamChunks.
   *
   * @param data - The raw JSON string from the SSE data field
   * @param accumulator - Provider-specific state for accumulating partial data
   * @returns Array of StreamChunks (may be empty for non-content chunks)
   */
  parseStreamChunk(data: string, accumulator: unknown): StreamChunk[];

  /**
   * Parse a non-streaming JSON response into a list of StreamChunks.
   *
   * @param json - The full response body as parsed JSON
   * @returns Array of StreamChunks including a final "done" chunk
   */
  parseResponse(json: unknown): StreamChunk[];

  /**
   * Create a fresh accumulator state for this provider's streaming parser.
   * Used to track partial tool calls, message blocks, etc. across chunks.
   */
  createAccumulator(): unknown;
}

/**
 * Result from parsing an SSE line — either parsed chunks or a control signal.
 */
export type SSEParseResult =
  | { type: "chunks"; chunks: StreamChunk[] }
  | { type: "done" }
  | { type: "skip" };
