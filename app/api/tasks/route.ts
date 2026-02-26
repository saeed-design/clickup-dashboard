import { NextRequest, NextResponse } from "next/server";
import { fetchAllTasks, fetchStatuses, fetchMembers } from "@/lib/clickup";
import { readCache, writeCache } from "@/lib/task-cache";
import type { ClickUpTask } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for fetching from large workspaces

function jsonError(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "true";

  try {
    // Try cache first (instant)
    if (!refresh) {
      const cached = await readCache();
      if (cached) {
        return NextResponse.json(
          buildResponse(cached.tasks, cached.statuses, cached.members, cached.cachedAt)
        );
      }
    }

    // Cache miss or forced refresh -- fetch from ClickUp in parallel
    const [tasksResult, statusResult, memberResult] = await Promise.allSettled([
      fetchAllTasks(),
      fetchStatuses(),
      fetchMembers(),
    ]);

    if (tasksResult.status === "rejected") {
      throw tasksResult.reason;
    }

    const tasks = tasksResult.value;
    const statuses = statusResult.status === "fulfilled" ? statusResult.value : [];
    const members = memberResult.status === "fulfilled" ? memberResult.value : [];
    const cachedAt = new Date();

    // Write cache in the background (don't block response)
    writeCache(tasks, statuses, members).catch(() => {});

    return NextResponse.json(buildResponse(tasks, statuses, members, cachedAt));
  } catch (e: unknown) {
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
