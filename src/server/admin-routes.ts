/**
 * Admin Panel Routes
 *
 * Route handlers for the admin/debug panel.
 * Fragment routes return HTML partials for HTMX; API routes return JSON.
 *
 * @module
 */

import { join } from "@std/path";
import type { RouteContext } from "./routes.ts";
import { queryLogs, getLogComponents, getLogLevelCounts, type LogLevel } from "./logger.ts";
import { collectDiagnostics } from "./diagnostics.ts";
import { getAllJobs, triggerJob } from "./cron-tracker.ts";
import { renderAdminHub, renderAdminLogs, renderLogEntries, renderAdminDiagnostics, renderAdminJobs, renderAdminJobRows, renderAdminActions, renderAdminEntityData } from "./admin-templates.ts";
import { getActiveProfile } from "../llm/settings.ts";
import { exportEntityData, importEntityData } from "./entity-data.ts";

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8" };
const JSON_HEADERS = { "Content-Type": "application/json" };
const VALID_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

/**
 * GET /fragments/admin — Admin hub with sub-navigation.
 */
export function handleAdminFragment(_ctx: RouteContext): Response {
  return new Response(renderAdminHub(), { headers: HTML_HEADERS });
}

/**
 * GET /fragments/admin/logs — Log viewer fragment.
 * Renders the shell with filter controls and initial log data.
 */
export function handleAdminLogsFragment(_ctx: RouteContext): Response {
  const entries = queryLogs({ limit: 100 });
  const components = getLogComponents();
  return new Response(renderAdminLogs(entries, components), { headers: HTML_HEADERS });
}

/**
 * GET /fragments/admin/diagnostics — Diagnostics dashboard fragment.
 */
export async function handleAdminDiagnosticsFragment(ctx: RouteContext): Promise<Response> {
  const snapshot = await collectDiagnostics(ctx);
  return new Response(renderAdminDiagnostics(snapshot), { headers: HTML_HEADERS });
}

/**
 * GET /api/admin/logs — JSON log entries with optional filtering.
 * Query params: level, component, limit, since
 */
export function handleAdminLogsAPI(_ctx: RouteContext, url: URL): Response {
  const rawLevel = url.searchParams.get("level");
  const level: LogLevel | undefined = rawLevel && VALID_LEVELS.has(rawLevel as LogLevel) ? rawLevel as LogLevel : undefined;
  const component = url.searchParams.get("component");
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const since = url.searchParams.get("since");

  const entries = queryLogs({
    level,
    component: component || undefined,
    limit: isNaN(limit) ? 100 : limit,
    since: since || undefined,
  });

  return new Response(JSON.stringify({ entries, counts: getLogLevelCounts() }), {
    headers: JSON_HEADERS,
  });
}

/**
 * GET /api/admin/logs/entries — HTML partial of log entries only.
 * Used by HTMX to refresh just the log list without the filter controls.
 * Query params: level, component, limit, since
 */
export function handleAdminLogEntriesAPI(_ctx: RouteContext, url: URL): Response {
  const rawLevel = url.searchParams.get("level");
  const level: LogLevel | undefined = rawLevel && VALID_LEVELS.has(rawLevel as LogLevel) ? rawLevel as LogLevel : undefined;
  const component = url.searchParams.get("component");
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const since = url.searchParams.get("since");

  const entries = queryLogs({
    level,
    component: component || undefined,
    limit: isNaN(limit) ? 100 : limit,
    since: since || undefined,
  });

  return new Response(renderLogEntries(entries), { headers: HTML_HEADERS });
}

/**
 * GET /api/admin/diagnostics — JSON diagnostics snapshot.
 */
export async function handleAdminDiagnosticsAPI(ctx: RouteContext): Promise<Response> {
  const snapshot = await collectDiagnostics(ctx);
  return new Response(JSON.stringify(snapshot), { headers: JSON_HEADERS });
}

/**
 * GET /fragments/admin/jobs — Scheduled jobs dashboard fragment.
 */
export function handleAdminJobsFragment(_ctx: RouteContext): Response {
  const jobs = getAllJobs();
  return new Response(renderAdminJobs(jobs), { headers: HTML_HEADERS });
}

/**
 * GET /api/admin/jobs/rows — HTML partial of job table rows only.
 * Used by HTMX to refresh just the table body without a full panel re-render.
 */
export function handleAdminJobRowsFragment(_ctx: RouteContext): Response {
  const jobs = getAllJobs();
  return new Response(renderAdminJobRows(jobs), { headers: HTML_HEADERS });
}

/**
 * GET /api/admin/jobs — JSON scheduled jobs status.
 */
export function handleAdminJobsAPI(_ctx: RouteContext): Response {
  const jobs = getAllJobs();
  return new Response(JSON.stringify({ jobs }), { headers: JSON_HEADERS });
}

/**
 * POST /api/admin/jobs/:id/trigger — Manually trigger a scheduled job.
 * Returns updated job rows HTML for HTMX to swap into the tbody.
 */
export async function handleAdminJobTriggerAPI(_ctx: RouteContext, jobId: string): Promise<Response> {
  await triggerJob(jobId);
  const jobs = getAllJobs();
  return new Response(renderAdminJobRows(jobs), { headers: HTML_HEADERS });
}

/**
 * GET /fragments/admin/actions — Actions panel fragment.
 */
export function handleAdminActionsFragment(_ctx: RouteContext): Response {
  return new Response(renderAdminActions(), { headers: HTML_HEADERS });
}

/**
 * POST /api/admin/actions/batch-populate — Run the batch-populate-graph script.
 * Accepts JSON body with { days, granularity, dryRun, verbose }.
 * Spawns the entity-core script as a subprocess and streams output.
 */
export async function handleAdminBatchPopulate(_ctx: RouteContext, body: Record<string, unknown>): Promise<Response> {
  const days = typeof body.days === "number" ? body.days : 30;
  const granularity = typeof body.granularity === "string" ? body.granularity : "daily";
  const dryRun = body.dryRun === true;
  const verbose = body.verbose === true;

  const entityCoreRoot = Deno.env.get("PSYCHEROS_ENTITY_CORE_PATH") ||
    join(_ctx.projectRoot, "..", "entity-core");

  const profileSettings = _ctx.getLLMProfileSettings();
  const activeProfile = getActiveProfile(profileSettings);

  const args = [
    "run", "-A",
    `${entityCoreRoot}/scripts/batch-populate-graph.ts`,
    `--days`, String(days),
    `--granularity`, granularity,
  ];
  if (dryRun) args.push("--dry-run");
  if (verbose) args.push("--verbose");

  try {
    const cmd = new Deno.Command("deno", {
      args,
      env: {
        ...Deno.env.toObject(),
        ENTITY_CORE_DATA_DIR: Deno.env.get("PSYCHEROS_ENTITY_CORE_DATA_DIR") || `${entityCoreRoot}/data`,
        ENTITY_CORE_LLM_API_KEY: Deno.env.get("ENTITY_CORE_LLM_API_KEY") || activeProfile?.apiKey || Deno.env.get("ZAI_API_KEY") || "",
        ENTITY_CORE_LLM_BASE_URL: Deno.env.get("ENTITY_CORE_LLM_BASE_URL") || activeProfile?.baseUrl || Deno.env.get("ZAI_BASE_URL") || "",
        ENTITY_CORE_LLM_MODEL: Deno.env.get("ENTITY_CORE_LLM_MODEL") || activeProfile?.model || Deno.env.get("ZAI_MODEL") || "",
        ZAI_API_KEY: Deno.env.get("ZAI_API_KEY") || "",
        ZAI_BASE_URL: Deno.env.get("ZAI_BASE_URL") || "",
        ZAI_MODEL: Deno.env.get("ZAI_MODEL") || "",
      },
      stdout: "piped",
      stderr: "piped",
    });

    const process = cmd.spawn();
    const [stdout, stderr] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    const status = await process.status;

    const output = stdout + (stderr ? `\n--- stderr ---\n${stderr}` : "");
    const success = status.success;

    return new Response(JSON.stringify({ success, exitCode: status.code, output }), {
      headers: JSON_HEADERS,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      exitCode: -1,
      output: `Failed to spawn script: ${error instanceof Error ? error.message : String(error)}`,
    }), { headers: JSON_HEADERS });
  }
}

// ===== Instance Suffix Migration =====

const DAILY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface RenameCandidate {
  oldName: string;
  newName: string;
  dir: string;
  scope: string;
}

/**
 * POST /api/admin/actions/add-instance-suffix — Add instance suffix to old memory files.
 * Accepts JSON body with { instanceId, apply, scopes }.
 * - instanceId: suffix to append (defaults to PSYCHEROS_MCP_INSTANCE or "psycheros")
 * - apply: boolean, actually rename files (default false = dry run)
 * - scopes: "psycheros" | "entity-core" | "both" (default "both")
 */
export async function handleAdminAddInstanceSuffix(ctx: RouteContext, body: Record<string, unknown>): Promise<Response> {
  const instanceId = typeof body.instanceId === "string" && body.instanceId.trim()
    ? body.instanceId.trim()
    : Deno.env.get("PSYCHEROS_MCP_INSTANCE") || "psycheros";
  const apply = body.apply === true;
  const scopes = typeof body.scopes === "string" ? body.scopes : "both";

  const lines: string[] = [];
  lines.push(`Instance suffix: ${instanceId}`);
  lines.push(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  lines.push(`Scopes: ${scopes}`);
  lines.push("");

  const candidates: RenameCandidate[] = [];
  const errors: string[] = [];

  const psycherosMemories = join(ctx.projectRoot, "memories");

  // Scan Psycheros memories
  if (scopes === "psycheros" || scopes === "both") {
    lines.push("[Psycheros memories]");
    for (const granularity of ["daily", "significant"] as const) {
      await collectUnsuffixed(join(psycherosMemories, granularity), granularity, instanceId, "psycheros", candidates, errors);
    }
  }

  // Scan entity-core memories
  if (scopes === "entity-core" || scopes === "both") {
    const entityCoreDataDir = Deno.env.get("PSYCHEROS_ENTITY_CORE_DATA_DIR");
    if (entityCoreDataDir) {
      lines.push("[entity-core memories]");
      for (const granularity of ["daily", "significant"] as const) {
        await collectUnsuffixed(join(entityCoreDataDir, "memories", granularity), granularity, instanceId, "entity-core", candidates, errors);
      }
    } else {
      lines.push("[entity-core memories] skipped — PSYCHEROS_ENTITY_CORE_DATA_DIR not set");
    }
  }

  lines.push("");
  lines.push(`Found ${candidates.length} file${candidates.length === 1 ? "" : "s"} to rename.`);

  if (candidates.length === 0 && errors.length === 0) {
    lines.push("All memory files already have instance suffixes.");
  }

  // Apply renames if requested
  let renamed = 0;
  if (apply && candidates.length > 0) {
    lines.push("");
    lines.push("Renaming...");
    for (const c of candidates) {
      try {
        await Deno.rename(join(c.dir, c.oldName), join(c.dir, c.newName));
        lines.push(`  [OK] ${c.scope}: ${c.oldName} → ${c.newName}`);
        renamed++;
      } catch (error) {
        lines.push(`  [FAIL] ${c.scope}: ${c.oldName} — ${error instanceof Error ? error.message : String(error)}`);
        errors.push(`${c.scope}/${c.oldName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    lines.push(`Renamed ${renamed} of ${candidates.length} files.`);
  } else if (candidates.length > 0) {
    // Show preview
    for (const c of candidates) {
      lines.push(`  ${c.scope}: ${c.oldName} → ${c.newName}`);
    }
    lines.push("");
    lines.push("Run with Apply checked to rename these files.");
  }

  if (errors.length > 0) {
    lines.push("");
    lines.push(`Errors: ${errors.length}`);
    for (const err of errors) {
      lines.push(`  ${err}`);
    }
  }

  const success = errors.length === 0;

  return new Response(JSON.stringify({
    success,
    output: lines.join("\n"),
    total: candidates.length,
    renamed,
    errors: errors.length,
  }), { headers: JSON_HEADERS });
}

/**
 * Scan a directory for memory files missing an instance suffix.
 */
async function collectUnsuffixed(
  dir: string,
  granularity: "daily" | "significant",
  instanceId: string,
  scope: string,
  candidates: RenameCandidate[],
  errors: string[],
): Promise<void> {
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;

      const stem = entry.name.replace(/\.md$/, "");

      // Skip if already has an instance suffix
      if (hasSuffix(stem, granularity)) continue;

      const newName = `${stem}_${instanceId}.md`;
      candidates.push({ oldName: entry.name, newName, dir, scope });
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      errors.push(`${scope}/${granularity}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Check if a filename stem already carries an instance suffix.
 *
 * Daily:    "2026-04-01"        → no suffix (plain date)
 *           "2026-04-01_foo"    → has suffix
 *           "2026-04-01_bar"    → has suffix (even if old id like "psycheros-harness")
 *
 * Significant: "my-memory"     → no suffix
 *              "my-memory_foo" → has suffix
 */
function hasSuffix(stem: string, granularity: "daily" | "significant"): boolean {
  if (granularity === "daily") {
    if (DAILY_DATE_RE.test(stem)) return false;           // bare date
    if (/^\d{4}-\d{2}-\d{2}_/.test(stem)) return true;  // date_instance
    return true; // doesn't look like a daily file at all
  }
  // Significant: any underscore means it already has a suffix
  return stem.includes("_");
}

// ===== Entity Data Export & Import =====

/**
 * GET /fragments/admin/entity-data — Entity Data tab fragment.
 */
export function handleAdminEntityDataFragment(_ctx: RouteContext): Response {
  return new Response(renderAdminEntityData(), { headers: HTML_HEADERS });
}

/**
 * POST /api/admin/entity-data/export — Export entity data as a zip download.
 */
export async function handleAdminEntityDataExport(ctx: RouteContext): Promise<Response> {
  try {
    const zipBytes = await exportEntityData(ctx);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return new Response(zipBytes.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="entity-export-${timestamp}.zip"`,
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }), { headers: JSON_HEADERS });
  }
}

/**
 * POST /api/admin/entity-data/import — Import entity data from an uploaded zip.
 */
export async function handleAdminEntityDataImport(ctx: RouteContext, body: Uint8Array): Promise<Response> {
  try {
    const result = await importEntityData(ctx, body);
    return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }), { headers: JSON_HEADERS });
  }
}

/**
 * POST /api/admin/data-migration/memories — Import memory .md files via direct copy.
 * Accepts FormData with 'files' field (multiple .md) and 'granularity' field.
 * Copies files directly into entity-core's memory directory.
 */
export async function handleAdminDataMigrationMemories(ctx: RouteContext, request: Request): Promise<Response> {
  const result = { success: true, imported: 0, errors: [] as Array<{ filename: string; error: string }>, error: "" };

  try {
    const entityCoreRoot = Deno.env.get("PSYCHEROS_ENTITY_CORE_PATH") ||
      join(ctx.projectRoot, "..", "entity-core");
    const entityCoreDataDir = Deno.env.get("PSYCHEROS_ENTITY_CORE_DATA_DIR") ||
      `${entityCoreRoot}/data`;

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const granularity = (formData.get("granularity") as string) || "daily";

    if (!["daily", "significant"].includes(granularity)) {
      return new Response(JSON.stringify({
        ...result, success: false,
        error: `Invalid granularity: ${granularity}. Must be "daily" or "significant".`,
      }), { headers: JSON_HEADERS });
    }

    if (files.length === 0) {
      return new Response(JSON.stringify({
        ...result, success: false,
        error: "No files provided",
      }), { headers: JSON_HEADERS });
    }

    const targetDir = join(entityCoreDataDir, "memories", granularity);

    // Ensure target directory exists
    await Deno.mkdir(targetDir, { recursive: true });

    for (const file of files) {
      const filename = file.name;

      if (!filename.endsWith(".md")) {
        result.errors.push({ filename, error: "Not a .md file" });
        continue;
      }

      // Check for filename collision
      const targetPath = join(targetDir, filename);
      try {
        await Deno.stat(targetPath);
        result.errors.push({ filename, error: "File already exists — skipping to prevent overwrite" });
        continue;
      } catch {
        // File doesn't exist, proceed
      }

      try {
        const content = new Uint8Array(await file.arrayBuffer());
        await Deno.writeFile(targetPath, content);
        result.imported++;
      } catch (err) {
        result.errors.push({ filename, error: err instanceof Error ? err.message : String(err) });
      }
    }

    result.success = result.errors.length === 0;
    return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
  } catch (error) {
    return new Response(JSON.stringify({
      ...result, success: false,
      error: error instanceof Error ? error.message : String(error),
    }), { headers: JSON_HEADERS });
  }
}
