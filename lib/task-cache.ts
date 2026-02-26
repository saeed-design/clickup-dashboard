/* ── JSON file cache for ClickUp tasks ──
 *
 * Writes to /tmp/clickup-tasks-cache.json.
 * On Vercel this survives warm function restarts (ephemeral per instance).
 * Locally it persists until the file is deleted.
 *
 * The cache stores: { timestamp (ISO), tasks (ClickUpTask[]) }
 * Default staleness: 1 hour.
 */

import { promises as fs } from "fs";
import path from "path";
import type { ClickUpTask, ClickUpStatus, ClickUpAssignee } from "./types";

const CACHE_PATH = path.join("/tmp", "clickup-tasks-cache.json");
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

interface CachePayload {
  timestamp: string; // ISO
  tasks: ClickUpTask[];
  statuses?: ClickUpStatus[];
  members?: ClickUpAssignee[];
}

export interface CacheData {
  tasks: ClickUpTask[];
  statuses: ClickUpStatus[];
  members: ClickUpAssignee[];
  cachedAt: Date;
}

/** Read cache from disk. Returns null if missing, corrupt, or stale. */
export async function readCache(): Promise<CacheData | null> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf-8");
    const data: CachePayload = JSON.parse(raw);

    if (!data.tasks || !data.timestamp) return null;

    const cachedAt = new Date(data.timestamp);
    const age = Date.now() - cachedAt.getTime();

    if (age > MAX_AGE_MS) {
      console.log(`[v0] Cache stale (${Math.round(age / 60_000)}m)`);
      return null;
    }

    console.log(`[v0] Cache hit: ${data.tasks.length} tasks, ${Math.round(age / 60_000)}m old`);

    return {
      tasks: data.tasks,
      statuses: data.statuses ?? [],
      members: data.members ?? [],
      cachedAt,
    };
  } catch {
    return null;
  }
}

/** Update a single task in the cache (in-place). */
export async function updateCacheTask(updated: ClickUpTask): Promise<void> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf-8");
    const data: CachePayload = JSON.parse(raw);
    if (!data.tasks) return;

    const idx = data.tasks.findIndex((t) => t.id === updated.id);
    if (idx !== -1) {
      data.tasks[idx] = updated;
    }
    await fs.writeFile(CACHE_PATH, JSON.stringify(data), "utf-8");
  } catch {
    // Cache doesn't exist or is corrupt -- nothing to patch
  }
}

/** Write everything to cache on disk. */
export async function writeCache(
  tasks: ClickUpTask[],
  statuses: ClickUpStatus[] = [],
  members: ClickUpAssignee[] = []
): Promise<void> {
  const payload: CachePayload = {
    timestamp: new Date().toISOString(),
    tasks,
    statuses,
    members,
  };
  try {
    await fs.writeFile(CACHE_PATH, JSON.stringify(payload), "utf-8");
    console.log(`[v0] Cache written: ${tasks.length} tasks`);
  } catch (err) {
    console.error("[v0] Failed to write cache:", err);
  }
}
