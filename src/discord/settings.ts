/**
 * Discord Gateway Settings Persistence
 *
 * Manages loading and saving Discord Gateway configuration settings to disk.
 * Settings are stored in `.psycheros/discord-gateway-settings.json` and fall
 * back to environment variables when the file doesn't exist.
 *
 * @module
 */

import { join } from "@std/path";
import type { DiscordGatewaySettings } from "./types.ts";

// =============================================================================
// Defaults
// =============================================================================

/**
 * Build default Discord Gateway settings from environment variables.
 */
export function getDefaultDiscordGatewaySettings(): DiscordGatewaySettings {
  const channelIds = Deno.env.get("DISCORD_LISTEN_CHANNEL_IDS") || "";
  const userIds = Deno.env.get("DISCORD_ALLOWED_USER_IDS") || "";

  return {
    listenChannelIds: channelIds ? channelIds.split(",").map((s) => s.trim()).filter(Boolean) : [],
    allowedUserIds: userIds ? userIds.split(",").map((s) => s.trim()).filter(Boolean) : [],
    enableGateway: Deno.env.get("DISCORD_GATEWAY_ENABLED") === "true",
    showToolExecution: true,
    streamingEdits: true,
    dmResponses: true,
  };
}

// =============================================================================
// Load / Save
// =============================================================================

/**
 * Load Discord Gateway settings from the settings file.
 * Falls back to environment variable defaults if the file doesn't exist.
 *
 * @param projectRoot - Root directory of the project
 * @returns The loaded Discord Gateway settings
 */
export async function loadDiscordGatewaySettings(projectRoot: string): Promise<DiscordGatewaySettings> {
  const defaults = getDefaultDiscordGatewaySettings();
  const settingsPath = join(projectRoot, ".psycheros", "discord-gateway-settings.json");

  try {
    const text = await Deno.readTextFile(settingsPath);
    const saved = JSON.parse(text) as Partial<DiscordGatewaySettings>;
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}

/**
 * Save Discord Gateway settings to the settings file.
 * Creates the `.psycheros/` directory if it doesn't exist.
 *
 * @param projectRoot - Root directory of the project
 * @param settings - The settings to save
 */
export async function saveDiscordGatewaySettings(
  projectRoot: string,
  settings: DiscordGatewaySettings,
): Promise<void> {
  const settingsDir = join(projectRoot, ".psycheros");
  const settingsPath = join(settingsDir, "discord-gateway-settings.json");

  await Deno.mkdir(settingsDir, { recursive: true });
  await Deno.writeTextFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

/**
 * Get a masked version of Discord Gateway settings for safe display.
 * This strips sensitive data before sending to the client.
 *
 * @param settings - The settings to mask
 * @returns The masked settings
 */
export function maskDiscordGatewaySettings(settings: DiscordGatewaySettings): DiscordGatewaySettings {
  // No sensitive fields in gateway settings currently — all are structural config
  return { ...settings };
}
