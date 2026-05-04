/**
 * Google Workspace Tool
 *
 * Provides access to Google Workspace services (Gmail, Calendar, Drive, Docs,
 * Sheets, Tasks, Contacts, Keep) via the `gog` CLI. Runs gog as a subprocess
 * using Deno.Command with structured arguments.
 */

import type { Tool, ToolContext, ToolExecutor } from "./types.ts";
import type { GoogleWorkspaceSettings } from "../llm/google-settings.ts";
import type { ToolDefinition, ToolResult } from "../types.ts";

// =============================================================================
// Tool Definition
// =============================================================================

const DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: "google_workspace",
    description:
      "Access Google Workspace (Gmail, Calendar, Drive, Docs, Sheets, Tasks, Contacts, Keep). I use this to manage email, check schedules, read/write documents, and handle productivity tasks.",
    parameters: {
      type: "object",
      properties: {
        service: {
          type: "string",
          enum: ["gmail", "calendar", "drive", "docs", "sheets", "tasks", "contacts", "keep", "people"],
          description: "The Google service to access",
        },
        action: {
          type: "string",
          description:
            'Action to perform. Service-specific:\n' +
            "- gmail: search, read, send, reply\n" +
            "- calendar: events, create_event\n" +
            "- drive: ls, read, cat\n" +
            "- docs: cat, write, find\n" +
            "- sheets: read (read cell data)\n" +
            "- tasks: list, add, complete\n" +
            "- contacts: search, list\n" +
            "- keep: list, read, create\n" +
            "- people: search",
        },
        query: {
          type: "string",
          description: "Search query (for gmail search, drive ls, contacts, etc.)",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Additional positional arguments for the gog command",
        },
        flags: {
          type: "object",
          description:
            "Named flags like {to: '...', subject: '...', max: 5, from: '2026-01-01', to_date: '2026-01-31'}",
        },
        body: {
          type: "string",
          description: "Message body for send/reply/write operations",
        },
      },
      required: ["service", "action"],
    },
  },
};

// =============================================================================
// Argument Types
// =============================================================================

interface GoogleWorkspaceArgs {
  service: string;
  action: string;
  query?: string;
  args?: string[];
  flags?: Record<string, unknown>;
  body?: string;
}

// =============================================================================
// Command Builder
// =============================================================================

/**
 * Build the gog command arguments for a given service/action pair.
 * Returns null for unknown combinations (falls through to passthrough).
 */
function buildCommand(
  gogPath: string,
  args: GoogleWorkspaceArgs,
  account?: string,
): string[] {
  const { service, action, query, args: positional, flags, body } = args;
  const extraArgs = positional ?? [];
  const f = flags ?? {};

  switch (`${service}/${action}`) {
    // Gmail
    case "gmail/search":
      return [gogPath, "gmail", "search", query || "", "--max", String(f.max || 10)];

    case "gmail/read":
      return [gogPath, "gmail", "get", ...extraArgs];

    case "gmail/send":
      return [
        gogPath, "gmail", "send",
        ...(f.to ? ["--to", String(f.to)] : []),
        ...(f.subject ? ["--subject", String(f.subject)] : []),
        ...(body ? [body] : []),
      ];

    case "gmail/reply":
      return [gogPath, "gmail", "reply", ...extraArgs, ...(body ? [body] : [])];

    // Calendar
    case "calendar/events":
      return [
        gogPath, "calendar", "events", account || "",
        ...(f.from ? ["--from", String(f.from)] : []),
        ...(f.to ? ["--to", String(f.to)] : []),
      ];

    case "calendar/create_event":
      return [gogPath, "calendar", "events", account || "", "--create"];

    // Drive
    case "drive/ls":
      return [gogPath, "drive", "ls", query || ""];

    case "drive/read":
    case "drive/cat":
      return [gogPath, "drive", "cat", ...extraArgs];

    // Docs
    case "docs/cat":
      return [gogPath, "docs", "cat", ...extraArgs];

    case "docs/write":
      return [
        gogPath, "docs", "write", ...extraArgs,
        ...(f.replace ? ["--replace"] : []),
        ...(f.markdown ? ["--markdown"] : []),
        ...(body ? [body] : []),
      ];

    // Sheets
    case "sheets/read":
      return [gogPath, "sheets", "read", ...extraArgs];

    // Tasks
    case "tasks/list":
      return [gogPath, "tasks", "list"];

    case "tasks/add":
      return [gogPath, "tasks", "add", body || query || "", ...extraArgs];

    case "tasks/complete":
      return [gogPath, "tasks", "complete", ...extraArgs];

    // Contacts
    case "contacts/search":
      return [gogPath, "contacts", "search", query || ""];

    case "contacts/list":
      return [gogPath, "contacts", "list"];

    // Keep
    case "keep/list":
      return [gogPath, "keep", "list"];

    case "keep/read":
      return [gogPath, "keep", "read", ...extraArgs];

    case "keep/create":
      return [gogPath, "keep", "create", body || query || ""];

    // People
    case "people/search":
      return [gogPath, "people", "search", query || ""];

    default:
      // Passthrough: let gog handle unknown combinations
      return [gogPath, service, action, ...extraArgs];
  }
}

// =============================================================================
// Result Formatting
// =============================================================================

/**
 * Format raw gog JSON output into a concise summary for the LLM.
 * Falls back to raw string output when JSON parsing fails.
 */
function formatOutput(rawOutput: string): string {
  // Try parsing as JSON
  try {
    const parsed = JSON.parse(rawOutput);

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return "No results found.";
      // Summarize array results
      const count = parsed.length;
      const sample = parsed.slice(0, 5);
      const items = sample.map((item: Record<string, unknown>) => {
        // Extract key fields based on what's available
        const subject = item.subject || item.title || item.name || item.summary || "";
        const from = item.from || item.sender || "";
        const date = item.date || item.when || item.updatedAt || "";
        const id = item.id || item.messageId || "";
        const parts: string[] = [];
        if (subject) parts.push(String(subject));
        if (from) parts.push(`from: ${from}`);
        if (date) parts.push(String(date));
        if (id) parts.push(`id: ${String(id)}`);
        return parts.join(" | ");
      }).join("\n");

      const truncated = count > 5 ? `\n...and ${count - 5} more` : "";
      return `${count} result(s):\n${items}${truncated}`;
    }

    if (typeof parsed === "object" && parsed !== null) {
      // Single object result — return a summary
      const keys = Object.keys(parsed).slice(0, 10);
      const summary = keys
        .filter((k) => k !== "raw" && k !== "html" && k !== "body")
        .map((k) => `${k}: ${JSON.stringify(parsed[k])}`)
        .join("\n");
      return summary || rawOutput.slice(0, 2000);
    }

    return String(parsed);
  } catch {
    // Not JSON — return raw output, truncated
    if (rawOutput.length > 4000) {
      return rawOutput.slice(0, 4000) + "\n...[truncated]";
    }
    return rawOutput || "Command completed with no output.";
  }
}

// =============================================================================
// Executor
// =============================================================================

/**
 * Execute the google_workspace tool.
 */
const execute: ToolExecutor = async (
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> => {
  // Read settings from entity config
  const settings = ctx.config.googleWorkspaceSettings as GoogleWorkspaceSettings | undefined;

  if (!settings?.enabled) {
    return {
      content: "Google Workspace integration is not enabled. Enable it in settings or set PSYCHEROS_GOOGLE_ENABLED=true.",
      isError: true,
    };
  }

  // Parse and validate arguments
  const parsed = args as GoogleWorkspaceArgs;
  if (!parsed.service || !parsed.action) {
    return {
      content: "Missing required parameters: 'service' and 'action' are required.",
      isError: true,
    };
  }

  const gogPath = settings.gogPath || "gog";

  // Build command arguments
  const cmdArgs = buildCommand(gogPath, parsed, settings.account);

  // Add JSON output flag and no-input flag to every command
  // Insert -j and --no-input after the gog binary path
  const fullArgs = [cmdArgs[0], "-j", "--no-input", ...cmdArgs.slice(1)];

  // Build environment with keyring password
  const env: Record<string, string> = {
    ...Deno.env.toObject(),
  };
  if (settings.keyringPassword) {
    env.GOG_KEYRING_PASSWORD = settings.keyringPassword;
  }
  // Add account flag if set
  if (settings.account) {
    fullArgs.splice(2, 0, "-a", settings.account);
  }

  try {
    const command = new Deno.Command(fullArgs[0], {
      args: fullArgs.slice(1),
      env,
      stdout: "piped",
      stderr: "piped",
    });

    const child = command.spawn();

    // Timeout after 30 seconds
    const timeoutId = setTimeout(() => child.kill("SIGKILL"), 30_000);

    try {
      const [stdout, stderr] = await Promise.all([
        child.output(),
        child.stderrOutput(),
      ]);

      clearTimeout(timeoutId);

      const status = child.status;
      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);

      if (!status.success) {
        return {
          content: `gog exited with code ${status.code}: ${errorOutput || output || "unknown error"}`,
          isError: true,
        };
      }

      return {
        content: formatOutput(output),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Failed to execute gog: ${message}`,
      isError: true,
    };
  }
};

// =============================================================================
// Export
// =============================================================================

export const googleWorkspaceTool: Tool = {
  definition: DEFINITION,
  execute,
};
