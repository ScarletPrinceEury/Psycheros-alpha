/**
 * Discord Gateway
 *
 * Bidirectional Discord integration that connects to the Discord Gateway API
 * via discord.js, listens for messages in configured channels and DMs,
 * drives EntityTurn.process() for responses, and posts streaming responses
 * back to Discord.
 *
 * Runs alongside the HTTP server and shares all infrastructure (DB, LLM,
 * MCP, tools, RAG, memory). Discord conversations are stored in the same
 * DB as web conversations and broadcast to the web UI via the event broadcaster.
 *
 * @module
 */

import type { DBClient } from "../db/mod.ts";
import type { LLMClient } from "../llm/mod.ts";
import type { ToolRegistry } from "../tools/mod.ts";
import type { ConversationRAG } from "../rag/conversation.ts";
import type { MCPClient } from "../mcp-client/mod.ts";
import type { LorebookManager } from "../lorebook/mod.ts";
import type { VaultManager } from "../vault/mod.ts";
import type { DiscordSettings } from "../llm/discord-settings.ts";
import type { DiscordGatewaySettings } from "./types.ts";
import type { WebSearchSettings } from "../llm/web-search-settings.ts";
import type { HomeSettings } from "../llm/home-settings.ts";
import type { ImageGenSettings } from "../llm/image-gen-settings.ts";
import type { LovenseSettings } from "../llm/lovense-settings.ts";
import type { ButtplugSettings } from "../llm/buttplug-settings.ts";
import type { EntityConfig } from "../entity/mod.ts";
import { EntityTurn } from "../entity/mod.ts";
import { getBroadcaster } from "../server/broadcaster.ts";
import { splitDiscordMessage, stripMarkdownForDiscord } from "./message-utils.ts";

// Discord.js is imported dynamically at runtime via npm specifiers.
// All discord.js types are used through import() expressions and inline typing.

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies and configuration getters for the Discord Gateway.
 * Follows the same pattern as PulseEngineConfig.
 */
export interface DiscordGatewayConfig {
  /** Root directory of the project */
  projectRoot: string;
  /** Discord bot token */
  botToken: string;
  /** Gateway-specific settings */
  gatewaySettings: DiscordGatewaySettings;
  /** Getter for Discord outbound settings */
  discordSettings: () => DiscordSettings | undefined;
  /** Database client */
  db: DBClient;
  /** LLM client getter */
  getLlm: () => LLMClient;
  /** Tool registry getter */
  tools: () => ToolRegistry;
  /** Optional chat RAG */
  chatRAG?: ConversationRAG;
  /** Optional MCP client */
  mcpClient?: MCPClient;
  /** Optional lorebook manager */
  lorebookManager?: LorebookManager;
  /** Optional vault manager */
  vaultManager?: VaultManager;
  /** Getter for web search settings */
  webSearchSettings?: () => WebSearchSettings | undefined;
  /** Getter for home settings */
  homeSettings?: () => HomeSettings | undefined;
  /** Getter for image gen settings */
  imageGenSettings?: () => ImageGenSettings | undefined;
  /** Getter for Lovense settings */
  lovenseSettings?: () => LovenseSettings | undefined;
  /** Getter for Buttplug settings */
  buttplugSettings?: () => ButtplugSettings | undefined;
  /** Getter for context window size from active LLM profile */
  contextLength?: () => number | undefined;
  /** Getter for max response tokens from active LLM profile */
  maxTokens?: () => number | undefined;
}

// =============================================================================
// Constants
// =============================================================================

/** Debounce interval for streaming edits (ms) */
const STREAM_DEBOUNCE_MS = 1500;

/** Minimum time between message edits to respect Discord rate limits (ms) */
const MIN_EDIT_INTERVAL_MS = 5500;

/** Maximum concurrent message handlers */
const MAX_CONCURRENT_HANDLERS = 5;

// =============================================================================
// Discord Gateway
// =============================================================================

/**
 * Bidirectional Discord gateway integration.
 *
 * Connects to Discord via discord.js, listens for messages, drives the
 * entity's agentic loop, and posts responses back to Discord with streaming
 * edits and proper rate limit handling.
 */
export class DiscordGateway {
  private client: import("discord.js").Client | null = null;
  private running = false;
  private activeHandlers = 0;
  private lastEditTime = 0;
  private pendingEdit: ReturnType<typeof setTimeout> | null = null;
  private conversationMap: Map<string, string> = new Map();

  constructor(private config: DiscordGatewayConfig) {}

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the Discord Gateway connection.
   * Creates a discord.js Client, registers event handlers, and logs in.
   */
  async start(): Promise<void> {
    if (this.running) return;
    if (!this.config.botToken) {
      console.log("[Discord] No bot token configured, gateway not started");
      return;
    }

    if (!this.config.gatewaySettings.enableGateway) {
      console.log("[Discord] Gateway is disabled in settings");
      return;
    }

    try {
      // Dynamically import discord.js (npm package in Deno)
      const { Client, GatewayIntentBits, Partials } = await import("discord.js");

      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel, Partials.Message],
      });

      this.client.on("ready", () => {
        this.running = true;
        console.log(`[Discord] Gateway connected as ${this.client!.user?.tag ?? "unknown"}`);
      });

      this.client.on("messageCreate", (message) => {
        // Deno.spawn to avoid blocking the event loop
        this.handleMessage(message).catch((error) => {
          console.error(
            "[Discord] Unhandled error in message handler:",
            error instanceof Error ? error.message : String(error),
          );
        });
      });

      this.client.on("error", (error) => {
        console.error("[Discord] Client error:", error instanceof Error ? error.message : String(error));
      });

      this.client.on("disconnect", (event) => {
        console.warn(`[Discord] Disconnected: ${event.reason || "unknown reason"}`);
        this.running = false;
      });

      await this.client.login(this.config.botToken);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Discord] Failed to start gateway: ${msg}`);
    }
  }

  /**
   * Stop the Discord Gateway connection gracefully.
   */
  async stop(): Promise<void> {
    if (!this.client) return;

    this.running = false;
    if (this.pendingEdit) {
      clearTimeout(this.pendingEdit);
      this.pendingEdit = null;
    }

    try {
      this.client.destroy();
    } catch (error) {
      console.error(
        "[Discord] Error during disconnect:",
        error instanceof Error ? error.message : String(error),
      );
    }

    this.client = null;
    console.log("[Discord] Gateway stopped");
  }

  /**
   * Check if the gateway is currently connected and running.
   */
  isConnected(): boolean {
    return this.running && this.client !== null;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Send a message to a Discord channel, handling union types.
   * PartialGroupDMChannel doesn't have .send(), so we check for it.
   */
  private async sendToChannel(
    channel: import("discord.js").Channel,
    content: string,
  ): Promise<import("discord.js").Message | undefined> {
    if ("send" in channel && typeof channel.send === "function") {
      return await channel.send(content);
    }
    return undefined;
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  /**
   * Handle an incoming Discord message.
   * Filters by channel/DM/user config, creates or reuses a conversation,
   * drives EntityTurn.process(), and posts the response to Discord.
   */
  private async handleMessage(message: import("discord.js").Message): Promise<void> {
    // Ignore bot messages (including our own)
    if (message.author.bot) return;

    // Check concurrent handler limit
    if (this.activeHandlers >= MAX_CONCURRENT_HANDLERS) {
      console.log("[Discord] Too many concurrent handlers, dropping message");
      return;
    }

    const content = message.content?.trim();
    if (!content) return;

    // Determine if this is a DM or channel message
    const isDM = message.channel.isDMBased();
    const channelId = message.channelId;
    const userId = message.author.id;

    // Apply filters
    if (isDM) {
      if (!this.config.gatewaySettings.dmResponses) return;
    } else {
      // Channel message — check if this channel is in the listen list
      if (!this.config.gatewaySettings.listenChannelIds.includes(channelId)) return;
    }

    // Check allowed users
    if (
      this.config.gatewaySettings.allowedUserIds.length > 0 &&
      !this.config.gatewaySettings.allowedUserIds.includes(userId)
    ) {
      return;
    }

    // Get or create conversation for this Discord channel
    const conversationId = this.getOrCreateConversation(channelId, isDM, message.author.username);

    // Handle image attachments
    let userMessage = content;
    if (message.attachments.size > 0) {
      const imageAttachment = message.attachments.find((a) =>
        a.contentType?.startsWith("image/")
      );
      if (imageAttachment) {
        userMessage = `[USER_IMAGE: ${imageAttachment.url}] ${content}`;
      }
    }

    this.activeHandlers++;

    try {
      await this.processAndRespond(message, conversationId, userMessage);
    } finally {
      this.activeHandlers--;
    }
  }

  /**
   * Process a message through the entity loop and post the response to Discord.
   */
  private async processAndRespond(
    triggerMessage: import("discord.js").Message,
    conversationId: string,
    userMessage: string,
  ): Promise<void> {
    // Build entity config (same pattern as Pulse engine)
    const entityConfig: EntityConfig = {
      projectRoot: this.config.projectRoot,
      chatRAG: this.config.chatRAG,
      mcpClient: this.config.mcpClient,
      lorebookManager: this.config.lorebookManager,
      vaultManager: this.config.vaultManager,
      webSearchSettings: this.config.webSearchSettings?.(),
      discordSettings: this.config.discordSettings?.(),
      homeSettings: this.config.homeSettings?.(),
      imageGenSettings: this.config.imageGenSettings?.(),
      lovenseSettings: this.config.lovenseSettings?.(),
      buttplugSettings: this.config.buttplugSettings?.(),
      contextLength: this.config.contextLength?.(),
      maxTokens: this.config.maxTokens?.(),
    };

    const turn = new EntityTurn(
      this.config.getLlm(),
      this.config.db,
      this.config.tools,
      entityConfig,
    );

    // Send initial placeholder if streaming edits are enabled
    let botMessage: import("discord.js").Message | null = null;
    let fullContent = "";

    const canStreamEdits = this.config.gatewaySettings.streamingEdits;

    try {
      // Post a "thinking" indicator
      if (canStreamEdits) {
        try {
          botMessage = await this.sendToChannel(triggerMessage.channel, "...") ?? null;
        } catch {
          // May not have permission to send
        }
      }

      // Stream the response
      for await (const chunk of turn.process(conversationId, userMessage)) {
        switch (chunk.type) {
          case "content":
            fullContent += chunk.content;
            break;

          case "tool_call":
            if (this.config.gatewaySettings.showToolExecution && botMessage) {
              try {
                await botMessage.react("⚙️");
              } catch {
                // May not have permission
              }
            }
            break;

          case "tool_result":
            if (this.config.gatewaySettings.showToolExecution && botMessage) {
              try {
                await botMessage.react("✅");
              } catch {
                // May not have permission
              }
            }
            break;

          case "thinking":
          case "status":
          case "metrics":
          case "context":
            break;
        }

        // Debounced streaming edit
        if (canStreamEdits && botMessage && fullContent.length > 0) {
          this.scheduleEdit(botMessage, fullContent);
        }

        // Broadcast to web UI
        try {
          const broadcaster = getBroadcaster();
          if (chunk.type === "content") {
            broadcaster.broadcastEvent("content", chunk.content, conversationId);
          } else if (chunk.type === "thinking") {
            broadcaster.broadcastEvent("thinking", chunk.content, conversationId);
          } else if (chunk.type === "tool_call") {
            broadcaster.broadcastEvent("tool_call", chunk.toolCall, conversationId);
          } else if (chunk.type === "tool_result") {
            broadcaster.broadcastEvent("tool_result", {
              toolCallId: chunk.result.toolCallId,
              content: chunk.result.content,
              isError: chunk.result.isError,
            }, conversationId);
          }
        } catch {
          // No web clients connected
        }
      }

      // Flush any pending edit
      if (this.pendingEdit) {
        clearTimeout(this.pendingEdit);
        this.pendingEdit = null;
      }

      // Post the final response
      const discordContent = stripMarkdownForDiscord(fullContent);

      if (botMessage && canStreamEdits) {
        // Edit the existing message
        if (discordContent.length > 0) {
          const chunks = splitDiscordMessage(discordContent);
          try {
            await botMessage.edit(chunks[0]);
          } catch {
            // Edit may fail due to rate limit — send new message instead
          }
          // Send remaining chunks as follow-up messages
          for (let i = 1; i < chunks.length; i++) {
            try {
              await this.sendToChannel(triggerMessage.channel, chunks[i]);
            } catch {
              break;
            }
          }
        } else {
          try {
            await botMessage.delete();
          } catch {
            // Ignore delete failure
          }
        }
      } else {
        // No streaming — send as new message(s)
        if (discordContent.length > 0) {
          const chunks = splitDiscordMessage(discordContent);
          for (const chunk of chunks) {
            try {
              await this.sendToChannel(triggerMessage.channel, chunk);
            } catch {
              break;
            }
          }
        }
      }

      // Signal stream completion to web UI
      try {
        const broadcaster = getBroadcaster();
        broadcaster.broadcastEvent("done", {}, conversationId);
      } catch {
        // No web clients
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Discord] Error processing message in ${conversationId}:`, errorMsg);

      // Send error to Discord
      try {
        await this.sendToChannel(
          triggerMessage.channel,
          `⚠️ Error processing message: ${errorMsg.substring(0, 500)}`,
        );
      } catch {
        // Ignore
      }

      // Signal error to web UI
      try {
        getBroadcaster().broadcastEvent("done", "error", conversationId);
      } catch {
        // No web clients
      }
    }
  }

  // ===========================================================================
  // Streaming Edit System
  // ===========================================================================

  /**
   * Schedule a debounced edit to the bot's message.
   * Batches edits to respect Discord's rate limits.
   */
  private scheduleEdit(message: import("discord.js").Message, content: string): void {
    if (this.pendingEdit) {
      clearTimeout(this.pendingEdit);
    }

    this.pendingEdit = setTimeout(async () => {
      this.pendingEdit = null;

      // Respect minimum edit interval
      const now = Date.now();
      const elapsed = now - this.lastEditTime;
      if (elapsed < MIN_EDIT_INTERVAL_MS) {
        const delay = MIN_EDIT_INTERVAL_MS - elapsed;
        setTimeout(() => this.doEdit(message, content), delay);
        return;
      }

      await this.doEdit(message, content);
    }, STREAM_DEBOUNCE_MS);
  }

  /**
   * Perform the actual message edit.
   */
  private async doEdit(message: import("discord.js").Message, content: string): Promise<void> {
    const discordContent = stripMarkdownForDiscord(content);
    if (!discordContent) return;

    try {
      // Truncate to Discord limit for the in-progress edit
      const truncated = discordContent.length > 2000
        ? discordContent.substring(0, 1997) + "..."
        : discordContent;

      await message.edit(truncated);
      this.lastEditTime = Date.now();
    } catch (error) {
      // Rate limited or other error — silently skip this edit
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("429")) {
        console.debug("[Discord] Edit rate limited, will retry on next chunk");
      }
    }
  }

  // ===========================================================================
  // Conversation Management
  // ===========================================================================

  /**
   * Get or create a conversation for a Discord channel.
   * Uses a deterministic title to find existing conversations across restarts.
   */
  private getOrCreateConversation(channelId: string, isDM: boolean, username: string): string {
    // Check in-memory cache first
    const cached = this.conversationMap.get(channelId);
    if (cached && this.config.db.getConversation(cached)) {
      return cached;
    }

    // Build a deterministic title to find existing conversations after restart
    const prefix = isDM ? "[Discord DM]" : "[Discord]";
    const title = `${prefix} ${username} (${channelId})`;

    // Search for an existing conversation with this title
    const conversations = this.config.db.listConversations();
    const existing = conversations.find((c) => c.title === title);
    if (existing) {
      this.conversationMap.set(channelId, existing.id);
      console.log(`[Discord] Reusing conversation ${existing.id} for channel ${channelId}`);
      return existing.id;
    }

    // Create a new conversation
    const conversation = this.config.db.createConversation(title);
    this.conversationMap.set(channelId, conversation.id);

    console.log(`[Discord] Created conversation ${conversation.id} for channel ${channelId} (${username})`);
    return conversation.id;
  }
}
