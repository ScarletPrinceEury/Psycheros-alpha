/**
 * LLM Module
 *
 * Provides the LLM client and settings management for multi-provider
 * LLM connection profiles. This module exports all types and the client
 * class for use throughout the Psycheros daemon.
 */

// Re-export types (only those used externally)
export type { ChatMessage, LLMConfig, StreamChunk } from "./types.ts";

export { LLMError } from "./types.ts";

// Re-export client
export { createDefaultClient, createWorkerClient, createClientFromProfile, LLMClient } from "./client.ts";

// Re-export provider adapters
export { openaiAdapter, anthropicAdapter, geminiAdapter } from "./providers/mod.ts";
export type { ProviderAdapter, ProviderRequest } from "./providers/mod.ts";

// Re-export provider presets and profile types
export type {
  LLMProvider,
  LLMConnectionProfile,
  LLMProfileSettings,
  LLMProviderPreset,
} from "./provider-presets.ts";
export {
  LLM_PROVIDER_PRESETS,
  inferProvider,
  inferProviderName,
  createDefaultProfile,
} from "./provider-presets.ts";

// Re-export settings
export type { LLMSettings } from "./settings.ts";
export {
  loadSettings,
  saveSettings,
  getDefaultSettings,
  maskApiKey,
  // Profile-based settings
  loadProfileSettings,
  saveProfileSettings,
  maskProfileSettings,
  getActiveProfile,
  profileToLLMSettings,
} from "./settings.ts";

// Re-export web search settings
export type { WebSearchSettings } from "./web-search-settings.ts";
export { loadWebSearchSettings, saveWebSearchSettings, getDefaultWebSearchSettings, maskWebSearchSettings } from "./web-search-settings.ts";

// Re-export Discord settings
export type { DiscordSettings } from "./discord-settings.ts";
export { loadDiscordSettings, saveDiscordSettings, getDefaultDiscordSettings, maskDiscordSettings } from "./discord-settings.ts";

// Re-export Home settings
export type { HomeSettings, HomeDevice } from "./home-settings.ts";
export { loadHomeSettings, saveHomeSettings, getDefaultHomeSettings } from "./home-settings.ts";

// Re-export Image Gen settings
export type { ImageGenSettings, ImageGenConfig, ImageGenProvider, ImageGenProviderSettings, CommonImageGenParams, CaptioningSettings, CaptioningProvider, CaptioningGeminiSettings, CaptioningOpenRouterSettings } from "./image-gen-settings.ts";
export { loadImageGenSettings, saveImageGenSettings, getDefaultImageGenSettings, maskImageGenSettings } from "./image-gen-settings.ts";

// Re-export Entity-Core LLM settings
export type { EntityCoreLLMSettings } from "./entity-core-settings.ts";
export { loadEntityCoreLLMSettings, saveEntityCoreLLMSettings, getDefaultEntityCoreLLMSettings } from "./entity-core-settings.ts";

// Re-export Lovense settings
export type { LovenseSettings } from "./lovense-settings.ts";
export { loadLovenseSettings, saveLovenseSettings, getDefaultLovenseSettings } from "./lovense-settings.ts";

// Re-export Buttplug settings
export type { ButtplugSettings } from "./buttplug-settings.ts";
export { loadButtplugSettings, saveButtplugSettings, getDefaultButtplugSettings } from "./buttplug-settings.ts";
