/* ── ClickUp API helpers ── */

import type { ClickUpAssignee, ClickUpStatus, ClickUpTask } from "./types";

const BASE = "https://api.clickup.com/api/v2";
const FETCH_TIMEOUT_MS = 20_000; // 20s per request
const MAX_PAGES = 50; // per list (ClickUp returns ~100 tasks/page)

function headers() {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) throw new Error("Missing CLICKUP_API_TOKEN");
  return { Authorization: token, "Content-Type": "application/json" };
}

function listIds(): string[] {
  const raw = process.env.CLICKUP_LIST_IDS;
  if (!raw) throw new Error("Missing CLICKUP_LIST_IDS");
  return raw.split(",").map((id) => id.trim());
}

function spaceId(): string | null {
  const raw = process.env.CLICKUP_SPACE_ID;
  return raw ? raw.trim() : null;
}

/** fetch with an AbortController timeout */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`ClickUp request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Recursively extract subtasks from ClickUp task tree ── */

function flattenTasks(tasks: ClickUpTask[]): ClickUpTask[] {
  const result: ClickUpTask[] = [];
  for (const t of tasks) {
    result.push(t);
    // ClickUp nests subtasks under the "subtasks" field when include_subtasks=true
    if (Array.isArray(t.subtasks) && t.subtasks.length > 0) {
      // Mark each subtask with parent id if not set
      for (const st of t.subtasks as ClickUpTask[]) {
        if (!st.parent) {
          (st as ClickUpTask & { parent: string }).parent = t.id;
        }
      }
      result.push(...flattenTasks(t.subtasks as ClickUpTask[]));
    }
  }
  return result;
}

/* ── Fetch all tasks from a single list (paginated) ── */

async function fetchListTasks(listId: string): Promise<ClickUpTask[]> {
  const tasks: ClickUpTask[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore && page < MAX_PAGES) {
    const url = `${BASE}/list/${listId}/task?subtasks=true&include_subtasks=true&include_closed=true&page=${page}`;
    const res = await fetchWithTimeout(url, {
      headers: headers(),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      console.log(`[v0] List ${listId} page ${page} failed: ${res.status}`);
      // Skip this list on error instead of crashing everything
      break;
    }

    const data = await res.json();
    const rawTasks: ClickUpTask[] = data.tasks ?? [];
    const flattened = flattenTasks(rawTasks);
    tasks.push(...flattened);

    hasMore = rawTasks.length > 0 && !data.last_page;
    page++;
  }

  return tasks;
}

/* ── Fetch all list IDs from a space ── */

// Cache list IDs for 5 minutes to avoid repeated fetches
let cachedListIds: { ids: string[]; timestamp: number } | null = null;
const LIST_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchAllListsFromSpace(spaceIdValue: string): Promise<string[]> {
  // Return cached list IDs if still valid
  if (cachedListIds && Date.now() - cachedListIds.timestamp < LIST_CACHE_TTL) {
    console.log(`[v0] Using cached list IDs: ${cachedListIds.ids.length} lists`);
    return cachedListIds.ids;
  }

  const listIds: string[] = [];
  const seen = new Set<string>();

  try {
    console.log(`[v0] Fetching all lists from space ${spaceIdValue}`);

    // Fetch folderless lists
    const folderlessUrl = `${BASE}/space/${spaceIdValue}/list`;
    const folderlessRes = await fetchWithTimeout(folderlessUrl, {
      headers: headers(),
      cache: "no-store",
    });

    if (folderlessRes.ok) {
      const folderlessData = await folderlessRes.json();
      for (const list of folderlessData.lists ?? []) {
        if (!seen.has(list.id)) {
          seen.add(list.id);
          listIds.push(list.id);
        }
      }
    }

    // Fetch folders
    const foldersUrl = `${BASE}/space/${spaceIdValue}/folder`;
    const foldersRes = await fetchWithTimeout(foldersUrl, {
      headers: headers(),
      cache: "no-store",
    });

    if (foldersRes.ok) {
      const foldersData = await foldersRes.json();
      const folders = foldersData.folders ?? [];

      // Fetch lists from each folder
      for (const folder of folders) {
        const folderListsUrl = `${BASE}/folder/${folder.id}/list`;
        const folderListsRes = await fetchWithTimeout(folderListsUrl, {
          headers: headers(),
          cache: "no-store",
        });

        if (folderListsRes.ok) {
          const folderListsData = await folderListsRes.json();
          for (const list of folderListsData.lists ?? []) {
            if (!seen.has(list.id)) {
              seen.add(list.id);
              listIds.push(list.id);
            }
          }
        }
      }
    }

    console.log(`[v0] Found ${listIds.length} lists in space ${spaceIdValue}`);
    
    // Cache the list IDs
    cachedListIds = { ids: listIds, timestamp: Date.now() };
  } catch (err) {
    console.error(`[v0] Error fetching lists from space:`, err);
  }

  return listIds;
}

/* ── Fetch all tasks from all lists in parallel ── */

export async function fetchAllTasks(): Promise<ClickUpTask[]> {
  // If space ID is configured, fetch all lists from the space
  // Otherwise, use the configured list IDs
  const space = spaceId();
  const ids = space ? await fetchAllListsFromSpace(space) : listIds();

  // Fetch all lists in parallel (3 concurrent max to avoid rate limits)
  const CONCURRENCY = 3;
  const allTasks: ClickUpTask[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((id) => fetchListTasks(id)));

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const task of result.value) {
          if (!seenIds.has(task.id)) {
            seenIds.add(task.id);
            allTasks.push(task);
          }
        }
      }
    }
  }

  console.log(
    `[v0] fetchAllTasks: ${allTasks.length} tasks from ${ids.length} lists`
  );

  return allTasks;
}

/* ── Fetch available statuses for lists ── */

export async function fetchStatuses(taskListIds?: string[]): Promise<ClickUpStatus[]> {
  // Priority order: provided list IDs > space lists > configured list IDs
  let ids: string[];
  if (taskListIds && taskListIds.length > 0) {
    ids = taskListIds;
  } else {
    const space = spaceId();
    ids = space ? await fetchAllListsFromSpace(space) : listIds();
  }
  
  const allStatuses: ClickUpStatus[] = [];
  const seen = new Set<string>();

  console.log(`[v0] Fetching statuses from ${ids.length} lists`);

  for (const listId of ids) {
    try {
      const res = await fetchWithTimeout(`${BASE}/list/${listId}`, {
        headers: headers(),
        cache: "no-store",
      });
      if (!res.ok) {
        console.log(`[v0] Failed to fetch statuses for list ${listId}: ${res.status}`);
        continue;
      }
      const data = await res.json();
      for (const s of data.statuses ?? []) {
        const key = s.status?.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          allStatuses.push({
            status: s.status,
            color: s.color,
            orderindex: s.orderindex,
          });
        }
      }
    } catch (err) {
      console.log(`[v0] Error fetching statuses for list ${listId}:`, err);
      // non-critical, skip
    }
  }

  console.log(`[v0] Found ${allStatuses.length} unique statuses`);

  return allStatuses.sort(
    (a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0)
  );
}

/* ── Fetch space members (assignee list) ── */

export async function fetchMembers(taskListIds?: string[]): Promise<ClickUpAssignee[]> {
  // Priority order: provided list IDs > space lists > configured list IDs
  let ids: string[];
  if (taskListIds && taskListIds.length > 0) {
    ids = taskListIds;
  } else {
    const space = spaceId();
    ids = space ? await fetchAllListsFromSpace(space) : listIds();
  }
  
  const members: ClickUpAssignee[] = [];
  const seen = new Set<number>();

  console.log(`[v0] Fetching members from ${ids.length} lists`);

  for (const listId of ids) {
    try {
      const res = await fetchWithTimeout(
        `${BASE}/list/${listId}/member`,
        { headers: headers(), cache: "no-store" }
      );
      if (!res.ok) {
        console.log(`[v0] Failed to fetch members for list ${listId}: ${res.status}`);
        continue;
      }
      const data = await res.json();
      for (const m of data.members ?? []) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          members.push({
            id: m.id,
            username: m.username,
            profilePicture: m.profilePicture,
          });
        }
      }
    } catch (err) {
      console.log(`[v0] Error fetching members for list ${listId}:`, err);
      // non-critical, skip
    }
  }

  console.log(`[v0] Found ${members.length} unique members`);

  return members.sort((a, b) => a.username.localeCompare(b.username));
}

/* ── Fetch single task (for before-snapshot) ── */

export async function fetchTask(taskId: string): Promise<ClickUpTask> {
  const res = await fetchWithTimeout(
    `${BASE}/task/${taskId}`,
    { headers: headers(), cache: "no-store" }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp API error fetching task ${taskId}: ${text}`);
  }
  return res.json();
}

/* ── Update task ── */

export async function updateTask(
  taskId: string,
  body: Record<string, unknown>
): Promise<ClickUpTask> {
  const res = await fetchWithTimeout(`${BASE}/task/${taskId}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp update failed (${res.status}): ${text}`);
  }
  return res.json();
}

/* ── Update custom field ── */

export async function updateCustomField(
  taskId: string,
  fieldId: string,
  value: unknown
): Promise<void> {
  const res = await fetchWithTimeout(`${BASE}/task/${taskId}/field/${fieldId}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `ClickUp custom field update failed (${res.status}): ${text}`
    );
  }
}
