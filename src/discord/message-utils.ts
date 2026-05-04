/**
 * Discord Message Utilities
 *
 * Helper functions for formatting and splitting messages for Discord.
 * Discord has a 2000 character limit per message and uses a subset of markdown.
 *
 * @module
 */

/** Maximum message length for a single Discord message */
const DISCORD_MESSAGE_LIMIT = 2000;

/** Minimum length to bother splitting (if under this, just send as-is and let Discord truncate) */
const MIN_SPLIT_LENGTH = 1900;

/**
 * Split a long message into chunks that fit within Discord's 2000 char limit.
 * Splits at natural boundaries (paragraphs, sentences, lines) to avoid
 * mid-word or mid-sentence breaks where possible.
 *
 * @param content - The content to split
 * @returns Array of message chunks, each within the 2000 char limit
 */
export function splitDiscordMessage(content: string): string[] {
  if (content.length <= DISCORD_MESSAGE_LIMIT) {
    return [content];
  }

  // Fast path: if content is just over the limit, split at the last safe boundary
  if (content.length <= MIN_SPLIT_LENGTH + 100) {
    const cut = content.lastIndexOf("\n", MIN_SPLIT_LENGTH);
    if (cut > 0) {
      return [content.substring(0, cut), content.substring(cut + 1)];
    }
    // No newline found, fall through to general splitter
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MESSAGE_LIMIT) {
      chunks.push(remaining);
      break;
    }

    // Try splitting at paragraph boundary
    let cutIndex = remaining.lastIndexOf("\n\n", DISCORD_MESSAGE_LIMIT - 50);

    // Try single newline
    if (cutIndex <= 0 || cutIndex < DISCORD_MESSAGE_LIMIT * 0.3) {
      cutIndex = remaining.lastIndexOf("\n", DISCORD_MESSAGE_LIMIT - 50);
    }

    // Try sentence boundary
    if (cutIndex <= 0 || cutIndex < DISCORD_MESSAGE_LIMIT * 0.3) {
      cutIndex = remaining.lastIndexOf(". ", DISCORD_MESSAGE_LIMIT - 50);
      if (cutIndex > 0) cutIndex += 2; // Include the period and space
    }

    // Try word boundary
    if (cutIndex <= 0 || cutIndex < DISCORD_MESSAGE_LIMIT * 0.3) {
      cutIndex = remaining.lastIndexOf(" ", DISCORD_MESSAGE_LIMIT - 50);
    }

    // Last resort: hard cut
    if (cutIndex <= 0 || cutIndex < DISCORD_MESSAGE_LIMIT * 0.3) {
      cutIndex = DISCORD_MESSAGE_LIMIT - 50;
    }

    chunks.push(remaining.substring(0, cutIndex).trimEnd());
    remaining = remaining.substring(cutIndex).trimStart();

    // Safety: if we didn't make progress, force a break
    if (remaining.length === content.length) {
      chunks.push(remaining.substring(0, DISCORD_MESSAGE_LIMIT));
      remaining = remaining.substring(DISCORD_MESSAGE_LIMIT);
    }
  }

  return chunks;
}

/**
 * Convert HTML/markdown to Discord-compatible markdown.
 * Discord supports: **bold**, *italic*, ~~strikethrough~~, `code`, ```code blocks```,
 * > quotes, - lists, [links](url), ||spoilers||
 *
 * @param md - The markdown/HTML content to convert
 * @returns Discord-compatible markdown string
 */
export function stripMarkdownForDiscord(md: string): string {
  let result = md;

  // Remove Psycheros timestamp tags (XML metadata, not user content)
  // Format: <t>YYYY-MM-DD HH:MM</t>
  result = result.replace(/<t>[^<]*<\/t>/g, "");

  // Remove IMAGE/USER_IMAGE markers — these don't render in Discord
  result = result.replace(/\[IMAGE:[^\]]*\]/g, "");
  result = result.replace(/\[USER_IMAGE:[^\]]*\]/g, "");

  // Remove remaining HTML tags that Discord doesn't support
  result = result.replace(/<[^>]+>/g, "");

  // Convert HTML entities
  result = result.replace(/&amp;/g, "&");
  result = result.replace(/&lt;/g, "<");
  result = result.replace(/&gt;/g, ">");
  result = result.replace(/&quot;/g, '"');
  result = result.replace(/&#39;/g, "'");
  result = result.replace(/&nbsp;/g, " ");

  // Collapse excessive blank lines (Discord treats >2 newlines same as 2)
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * Format a tool call for compact Discord display.
 *
 * @param name - Tool name
 * @param args - Tool arguments (truncated for display)
 * @returns Compact single-line tool call string
 */
export function formatToolCallForDiscord(name: string, args: Record<string, unknown>): string {
  const argEntries = Object.entries(args).slice(0, 3);
  const argStr = argEntries
    .map(([key, value]) => {
      const valStr = typeof value === "string" ? value : JSON.stringify(value);
      const truncated = valStr.length > 50 ? valStr.substring(0, 47) + "..." : valStr;
      return `${key}=${truncated}`;
    })
    .join(", ");

  return `⚙️ \`${name}(${argStr})\``;
}
