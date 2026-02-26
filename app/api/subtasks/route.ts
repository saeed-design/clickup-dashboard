import { NextRequest, NextResponse } from "next/server";
import { fetchAllTasks, fetchStatuses, fetchMembers } from "@/lib/clickup";
import { readCache, writeCache } from "@/lib/task-cache";
import type { ClickUpTask, ClickUpStatus, ClickUpAssignee } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for fetching from large workspaces

async function fetchClickUpPayload() {
  const [t, s, m] = await Promise.allSettled([
    fetchAllTasks(),
    fetchStatuses(),
    fetchMembers(),
  ]);

  if (t.status === "rejected") throw t.reason;

  return {
    allTasks: t.value,
    availableStatuses: s.status === "fulfilled" ? s.value : [],
    availableAssignees: m.status === "fulfilled" ? m.value : [],
  };
}

/**
 * GET /api/subtasks
 * Server-side filtered + paginated list of non-top-level tasks.
 *
 * Query params:
 *   page, limit, search, status, csm, assignee, priority, dueBefore, dueAfter, list
 *
 * Returns:
 *   { ok, tasks, total, page, limit, availableCSMs, availableStatuses, availableAssignees }
 */
export async function GET(req: NextRequest) {
  try {
    return await handleRequest(req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

async function handleRequest(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "25", 10)));
  const search = (sp.get("search") || "").toLowerCase().trim();
  const statusFilter = sp.get("status") || "";
  const csmFilter = (sp.get("csm") || "").toLowerCase().trim();
  const assigneeFilters = sp
    .getAll("assignee")
    .map((v) => v.toLowerCase().trim())
    .filter(Boolean);
  const priorityFilter = (sp.get("priority") || "").toLowerCase().trim();
  const listFilter = (sp.get("list") || "").toLowerCase().trim();
  const dueBefore = sp.get("dueBefore") || "";
  const dueAfter = sp.get("dueAfter") || "";
  const forceRefresh = sp.get("refresh") === "true";

  let allTasks: ClickUpTask[];
  let availableStatuses: ClickUpStatus[] = [];
  let availableAssignees: ClickUpAssignee[] = [];
  let cachedAt: Date | null = null;
  const staleCache = await readCache({ allowStale: true });

  // Try cache first (instant)
  if (!forceRefresh) {
    const cached = await readCache();
    if (cached) {
      allTasks = cached.tasks;
      availableStatuses = cached.statuses;
      availableAssignees = cached.members;
      cachedAt = cached.cachedAt;
      
      console.log("[v0] Using cached data - Statuses:", availableStatuses.length, "Assignees:", availableAssignees.length);
    } else {
      if (staleCache) {
        allTasks = staleCache.tasks;
        availableStatuses = staleCache.statuses;
        availableAssignees = staleCache.members;
        cachedAt = staleCache.cachedAt;

        console.log("[v0] Using stale cache while refreshing in background - Statuses:", availableStatuses.length, "Assignees:", availableAssignees.length);
        void fetchClickUpPayload()
          .then((payload) =>
            writeCache(
              payload.allTasks,
              payload.availableStatuses,
              payload.availableAssignees
            )
          )
          .catch((err) => console.log("[v0] Subtasks background refresh failed:", err));
      } else {
        // Cache miss -- fetch everything from ClickUp
        const payload = await fetchClickUpPayload();
        allTasks = payload.allTasks;
        availableStatuses = payload.availableStatuses;
        availableAssignees = payload.availableAssignees;
        cachedAt = new Date();

        console.log("[v0] Fresh fetch - Statuses:", availableStatuses.length, "Assignees:", availableAssignees.length);
        writeCache(allTasks, availableStatuses, availableAssignees).catch(() => {});
      }
    }
  } else {
    // Forced refresh - fetch everything fresh from space
    try {
      const payload = await fetchClickUpPayload();
      allTasks = payload.allTasks;
      availableStatuses = payload.availableStatuses;
      availableAssignees = payload.availableAssignees;
      cachedAt = new Date();

      console.log("[v0] Forced refresh - Statuses:", availableStatuses.length, "Assignees:", availableAssignees.length);
      writeCache(allTasks, availableStatuses, availableAssignees).catch(() => {});
    } catch (err) {
      if (!staleCache) throw err;

      allTasks = staleCache.tasks;
      availableStatuses = staleCache.statuses;
      availableAssignees = staleCache.members;
      cachedAt = staleCache.cachedAt;
      console.log("[v0] Forced refresh failed, serving stale cache:", err);
    }
  }

  // Build a taskId -> task lookup
  const taskMap = new Map<string, ClickUpTask>();
  for (const t of allTasks) {
    taskMap.set(t.id, t);
  }

  // Resolve top parent for a task (walk up the parent chain)
  function resolveTopParent(task: ClickUpTask): ClickUpTask | null {
    if (!task.parent) return null;
    let current = taskMap.get(task.parent);
    if (!current) return null;
    let depth = 0;
    while (current.parent && taskMap.has(current.parent) && depth < 10) {
      current = taskMap.get(current.parent)!;
      depth++;
    }
    return current;
  }

  // Extract CSM custom field value from a task (case-insensitive field name match)
  function extractCSM(task: ClickUpTask): string {
    if (!task.custom_fields) return "N/A";

    const csmField = task.custom_fields.find(
      (cf) => cf.name.toLowerCase().includes("csm")
    );
    if (!csmField || csmField.value == null) return "N/A";

    // Handle drop_down type: value is the option orderindex (number), resolve to name
    if (csmField.type === "drop_down" && csmField.type_config?.options) {
      const val = Number(csmField.value);
      const opt = csmField.type_config.options.find(
        (o) => Number(o.orderindex) === val
      );
      return opt?.name || opt?.label || String(csmField.value);
    }

    // Handle labels type: value is array of label UUIDs
    if (csmField.type === "labels" && Array.isArray(csmField.value) && csmField.type_config?.options) {
      const names = (csmField.value as string[])
        .map((id) => csmField.type_config!.options!.find((o) => o.id === id)?.name)
        .filter(Boolean);
      return names.length > 0 ? names.join(", ") : "N/A";
    }

    // Handle users / people type: value could be user object(s)
    if (csmField.type === "users" || csmField.type === "people") {
      if (Array.isArray(csmField.value)) {
        const names = (csmField.value as { username?: string; name?: string }[])
          .map((u) => u.username || u.name || "Unknown")
          .filter(Boolean);
        return names.length > 0 ? names.join(", ") : "N/A";
      }
      if (typeof csmField.value === "object" && csmField.value !== null) {
        const u = csmField.value as { username?: string; name?: string };
        return u.username || u.name || String(csmField.value);
      }
    }

    // Handle text / short_text
    if (typeof csmField.value === "string") return csmField.value || "N/A";

    return String(csmField.value);
  }

  // Build subtask list with enriched data
  const subtasks = allTasks
    .filter((t) => !!t.parent) // only non-top-level tasks
    .map((t) => {
      const topParent = resolveTopParent(t);
      return {
        ...t,
        _topParentId: topParent?.id ?? null,
        _topParentName: topParent?.name ?? "Unknown",
        _topParentCSM: topParent ? extractCSM(topParent) : "N/A",
      };
    });

  // Collect unique CSM values for filter dropdown
  const csmSet = new Set<string>();
  for (const st of subtasks) {
    if (st._topParentCSM !== "N/A") csmSet.add(st._topParentCSM);
  }
  const availableCSMs = [...csmSet].sort();

  // Collect unique list names
  const listSet = new Set<string>();
  for (const st of subtasks) {
    const name = st.list?.name;
    if (name) listSet.add(name);
  }
  const availableLists = [...listSet].sort();

  // Build a stable assignee list from workspace members + all subtasks assignees
  // so the frontend filter options do not change with page/filter state.
  const assigneeMap = new Map<number, ClickUpAssignee>();
  for (const member of availableAssignees) {
    assigneeMap.set(member.id, member);
  }
  for (const st of subtasks) {
    for (const a of st.assignees) {
      if (!assigneeMap.has(a.id)) {
        assigneeMap.set(a.id, {
          id: a.id,
          username: a.username,
          profilePicture: a.profilePicture,
        });
      }
    }
  }
  const stableAvailableAssignees = [...assigneeMap.values()].sort((a, b) =>
    a.username.localeCompare(b.username)
  );

  // Apply filters
  let filtered = subtasks;

  if (search) {
    filtered = filtered.filter(
      (t) =>
        t.name.toLowerCase().includes(search) ||
        t._topParentName.toLowerCase().includes(search)
    );
  }

  if (statusFilter) {
    const statuses = statusFilter.toLowerCase().split(",");
    filtered = filtered.filter((t) =>
      statuses.includes(t.status.status.toLowerCase())
    );
  }

  if (csmFilter) {
    filtered = filtered.filter(
      (t) => t._topParentCSM.toLowerCase() === csmFilter
    );
  }

  if (assigneeFilters.length > 0) {
    filtered = filtered.filter(
      (t) => {
        if (t.assignees.length === 0) {
          return assigneeFilters.includes("unassigned");
        }
        return t.assignees.some((a) =>
          assigneeFilters.includes(a.username.toLowerCase())
        );
      }
    );
  }

  if (priorityFilter) {
    filtered = filtered.filter(
      (t) =>
        (t.priority?.priority?.toLowerCase() || "none") === priorityFilter
    );
  }

  if (listFilter) {
    filtered = filtered.filter(
      (t) => (t.list?.name || "").toLowerCase().includes(listFilter)
    );
  }

  if (dueBefore) {
    const ts = new Date(dueBefore).getTime();
    filtered = filtered.filter(
      (t) => t.due_date && parseInt(t.due_date, 10) <= ts
    );
  }

  if (dueAfter) {
    const ts = new Date(dueAfter).getTime();
    filtered = filtered.filter(
      (t) => t.due_date && parseInt(t.due_date, 10) >= ts
    );
  }

  // Sort by last updated descending
  filtered.sort(
    (a, b) =>
      new Date(b.date_updated).getTime() - new Date(a.date_updated).getTime()
  );

  const total = filtered.length;
  const start = (page - 1) * limit;
  const pagedTasks = filtered.slice(start, start + limit);

  // ClickUp has 4 fixed priorities
  const availablePriorities = [
    { priority: "urgent", color: "#f50000" },
    { priority: "high", color: "#ffcc00" },
    { priority: "normal", color: "#6fddff" },
    { priority: "low", color: "#d8d8d8" },
  ];

  return NextResponse.json({
    ok: true,
    tasks: pagedTasks,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    availableCSMs,
    availableStatuses,
    availableAssignees: stableAvailableAssignees,
    availablePriorities,
    availableLists,
    cachedAt: cachedAt?.toISOString() ?? null,
  });
}
