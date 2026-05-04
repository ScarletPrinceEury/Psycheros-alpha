/**
 * Discord Gateway Module
 *
 * Barrel exports for the Discord Gateway integration.
 *
 * @module
 */

export { DiscordGateway, type DiscordGatewayConfig } from "./gateway.ts";
export type { DiscordGatewaySettings } from "./types.ts";
export {
  getDefaultDiscordGatewaySettings,
  loadDiscordGatewaySettings,
  saveDiscordGatewaySettings,
  maskDiscordGatewaySettings,
} from "./settings.ts";
export {
  splitDiscordMessage,
  stripMarkdownForDiscord,
  formatToolCallForDiscord,
} from "./message-utils.ts";
