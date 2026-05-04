/**
 * Google Workspace Settings Persistence
 *
 * Manages loading and saving Google Workspace (gog CLI) configuration
 * settings to disk. Settings are stored in `.psycheros/google-settings.json`
 * and fall back to environment variables when the file doesn't exist.
 */

import { join } from "@std/path";
import { maskApiKey } from "./settings.ts";

// =============================================================================
// Types
// =============================================================================

/**
 * User-configurable Google Workspace settings persisted to disk.
 */
export interface GoogleWorkspaceSettings {
  /** Whether Google Workspace integration is enabled */
  enabled: boolean;
  /** Path to gog binary (default: "gog" — assumes it's on PATH) */
  gogPath?: string;
  /** Keyring password for gog auth */
  keyringPassword?: string;
  /** Default Google account email */
  account?: string;
}

// =============================================================================
// Defaults
// =============================================================================

/**
 * Build default Google Workspace settings from environment variables.
 * Returns disabled if PSYCHEROS_GOOGLE_ENABLED is not set.
 */
export function getDefaultGoogleWorkspaceSettings(): GoogleWorkspaceSettings {
  const enabled = Deno.env.get("PSYCHEROS_GOOGLE_ENABLED") === "true";

  return {
    enabled,
    gogPath: Deno.env.get("GOG_PATH") || "gog",
    keyringPassword: Deno.env.get("GOG_KEYRING_PASSWORD") || "",
    account: Deno.env.get("GOOGLE_ACCOUNT") || "",
  };
}

// =============================================================================
// Load / Save
// =============================================================================

/**
 * Load Google Workspace settings from the settings file.
 * Falls back to environment variable defaults if the file doesn't exist.
 */
export async function loadGoogleWorkspaceSettings(projectRoot: string): Promise<GoogleWorkspaceSettings> {
  const defaults = getDefaultGoogleWorkspaceSettings();
  const settingsPath = join(projectRoot, ".psycheros", "google-settings.json");

  try {
    const text = await Deno.readTextFile(settingsPath);
    const saved = JSON.parse(text) as Partial<GoogleWorkspaceSettings>;
    // Merge saved settings over defaults (saved values take priority)
    return { ...defaults, ...saved };
  } catch {
    // File doesn't exist or is invalid - use defaults
    return defaults;
  }
}

/**
 * Save Google Workspace settings to the settings file.
 * Creates the `.psycheros/` directory if it doesn't exist.
 */
export async function saveGoogleWorkspaceSettings(
  projectRoot: string,
  settings: GoogleWorkspaceSettings,
): Promise<void> {
  const settingsDir = join(projectRoot, ".psycheros");
  const settingsPath = join(settingsDir, "google-settings.json");

  await Deno.mkdir(settingsDir, { recursive: true });
  await Deno.writeTextFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

/**
 * Get a masked version of Google Workspace settings for safe display.
 * Sensitive fields are masked using the same logic as LLM settings.
 */
export function maskGoogleWorkspaceSettings(settings: GoogleWorkspaceSettings): GoogleWorkspaceSettings {
  return {
    ...settings,
    keyringPassword: maskApiKey(settings.keyringPassword || ""),
  };
}
