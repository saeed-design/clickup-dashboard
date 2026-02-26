import { NextRequest, NextResponse } from "next/server";
import { fetchAllTasks, fetchStatuses, fetchMembers } from "@/lib/clickup";
import { readCache, writeCache } from "@/lib/task-cache";
import type { ClickUpTask } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for fetching from large workspaces
const FETCH_BUDGET_MS = 45_000;

function jsonError(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function fetchClickUpPayload() {
  const [tasksResult, statusResult, memberResult] = await Promise.allSettled([
    fetchAllTasks(),
    fetchStatuses(),
    fetchMembers(),
  ]);

  if (tasksResult.status === "rejected") {
    throw tasksResult.reason;
  }

  return {
    tasks: tasksResult.value,
    statuses: statusResult.status === "fulfilled" ? statusResult.value : [],
    members: memberResult.status === "fulfilled" ? memberResult.value : [],
  };
}

async function fetchWithBudget() {
  return Promise.race([
    fetchClickUpPayload(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`ClickUp fetch exceeded ${FETCH_BUDGET_MS}ms`)), FETCH_BUDGET_MS);
    }),
  ]);
}

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "true";
  const staleCache = await readCache({ allowStale: true });

  try {
    // Try fresh cache first (instant)
    if (!refresh) {
      const cached = await readCache();
      if (cached) {
        return NextResponse.json(
          buildResponse(cached.tasks, cached.statuses, cached.members, cached.cachedAt)
        );
      }

      // Return stale cache immediately and warm cache in background.
      if (staleCache) {
        void fetchWithBudget()
          .then((payload) => writeCache(payload.tasks, payload.statuses, payload.members))
          .catch((err) => console.log("[v0] Background refresh failed:", err));

        return NextResponse.json(
          buildResponse(
            staleCache.tasks,
            staleCache.statuses,
            staleCache.members,
            staleCache.cachedAt
          )
        );
      }
    }

    // Cache miss or forced refresh -- fetch from ClickUp with budget.
    const { tasks, statuses, members } = await fetchWithBudget();
    const cachedAt = new Date();

    // Write cache in the background (don't block response)
    writeCache(tasks, statuses, members).catch(() => {});

    return NextResponse.json(buildResponse(tasks, statuses, members, cachedAt));
  } catch (e: unknown) {
    // On refresh/fetch failure, serve stale cache if present to prevent hard failure.
    if (staleCache) {
      console.log("[v0] Serving stale cache after fetch failure:", e);
      return NextResponse.json(
        buildResponse(
          staleCache.tasks,
          staleCache.statuses,
          staleCache.members,
          staleCache.cachedAt
        )
      );
    }

    const message = e instanceof Error ? e.message : "Unknown error";
    return jsonError(message);
  }
}

function buildResponse(
  tasks: ClickUpTask[],
  availableStatuses: unknown[],
  availableAssignees: unknown[],
  cachedAt: Date | null
) {
  const parentMap = new Map<string, ClickUpTask[]>();
  const topLevel: ClickUpTask[] = [];

  for (const task of tasks) {
    if (task.parent) {
      const siblings = parentMap.get(task.parent) ?? [];
      siblings.push(task);
      parentMap.set(task.parent, siblings);
    } else {
      topLevel.push(task);
    }
  }

  for (const task of topLevel) {
    task.subtasks = parentMap.get(task.id) ?? [];
  }

  const byStatus: Record<string, number> = {};
  const byAssignee: Record<string, number> = {};

  for (const task of tasks) {
    const status = task.status?.status || "unknown";
    byStatus[status] = (byStatus[status] || 0) + 1;

    const assignee = task.assignees?.[0]?.username || "Unassigned";
    byAssignee[assignee] = (byAssignee[assignee] || 0) + 1;
  }

  return {
    ok: true,
    total: tasks.length,
    tasks: topLevel,
    byStatus,
    byAssignee,
    availableStatuses,
    availableAssignees,
    cachedAt: cachedAt?.toISOString() ?? null,
  };
}
