/**
 * Discord Gateway Types
 *
 * Configuration types for the Discord Gateway integration.
 * These extend the existing DiscordSettings (bot token, outbound DM)
 * with bidirectional gateway features.
 *
 * @module
 */

/**
 * User-configurable Discord Gateway settings persisted to disk.
 */
export interface DiscordGatewaySettings {
  /** Channel IDs the bot should listen in (empty = no channel listening) */
  listenChannelIds: string[];
  /** User IDs allowed to trigger the bot (empty = all users) */
  allowedUserIds: string[];
  /** Master toggle for bidirectional Discord gateway mode */
  enableGateway: boolean;
  /** Show tool execution as reactions on the bot's response message */
  showToolExecution: boolean;
  /** Enable streaming edits (update bot message while generating) */
  streamingEdits: boolean;
  /** Respond to DMs sent to the bot */
  dmResponses: boolean;
}
