"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import {
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  ListChecks,
  Filter,
  ExternalLink,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { InlineSelect } from "@/components/inline-select";
import type { ClickUpAssignee, ClickUpStatus } from "@/lib/types";

/* ── Types for the subtasks API response ── */

interface SubtaskWithParent {
  id: string;
  name: string;
  status: { status: string; color?: string };
  assignees: { id: number; username: string; profilePicture?: string }[];
  list: { id: string; name?: string };
  due_date: string | null;
  date_created: string;
  date_updated: string;
  priority?: { priority: string; color: string } | null;
  url?: string;
  parent?: string | null;
  custom_fields?: {
    id: string;
    name: string;
    type: string;
    value?: unknown;
    type_config?: {
      options?: {
        id: string;
        name: string;
        label?: string;
        color?: string;
        orderindex?: number;
      }[];
    };
  }[];
  _topParentId: string | null;
  _topParentName: string;
  _topParentCSM: string;
}

interface SubtasksApiResponse {
  ok: boolean;
  tasks: SubtaskWithParent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  availableCSMs: string[];
  availableStatuses: ClickUpStatus[];
  availableAssignees: ClickUpAssignee[];
  availablePriorities: { priority: string; color: string }[];
  availableLists: string[];
  cachedAt?: string | null;
  error?: string;
}

/* ── SWR fetcher ── */

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  if (json && !json.ok) throw new Error(json.error || "API returned an error");
  return json;
};

/* ── Status badge ── */

const STATUS_COLORS: Record<string, string> = {
  "open": "#6b7280",
  "to do": "#3b82f6",
  "in progress": "#f59e0b",
  "in review": "#8b5cf6",
  "complete": "#10b981",
  "done": "#10b981",
  "closed": "#10b981",
  "blocked": "#ef4444",
  "on hold": "#f97316",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status.toLowerCase()] || "#64748b";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `${color}18`,
        color,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {status}
    </span>
  );
}

/* ── Priority badge ── */

function PriorityBadge({ priority }: { priority?: { priority: string; color: string } | null }) {
  if (!priority) return <span className="text-muted-foreground text-xs">--</span>;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `${priority.color}18`,
        color: priority.color,
      }}
    >
      {priority.priority}
    </span>
  );
}

/* ── Date helpers ── */

function formatDate(raw: string | null): string {
  if (!raw) return "--";
  const d = new Date(/^\d+$/.test(raw) ? parseInt(raw, 10) : raw);
  if (isNaN(d.getTime())) return "--";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatRelative(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "--";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Custom field display ── */

function CustomFieldValue({
  field,
}: {
  field: {
    type: string;
    value?: unknown;
    type_config?: {
      options?: {
        id: string;
        name: string;
        label?: string;
        orderindex?: number;
      }[];
    };
  };
}) {
  if (field.value == null || field.value === "") {
    return <span className="text-muted-foreground">--</span>;
  }

  if (field.type === "drop_down" && field.type_config?.options) {
    const opt = field.type_config.options.find(
      (o) => o.orderindex === field.value
    );
    return <span>{opt?.name || opt?.label || String(field.value)}</span>;
  }

  if (field.type === "labels" && Array.isArray(field.value) && field.type_config?.options) {
    const names = (field.value as string[])
      .map((id) => field.type_config!.options!.find((o) => o.id === id)?.name)
      .filter(Boolean);
    return <span>{names.join(", ") || "--"}</span>;
  }

  if (field.type === "checkbox") {
    return <span>{field.value === true || field.value === "true" ? "Yes" : "No"}</span>;
  }

  return <span>{String(field.value)}</span>;
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 min-w-[180px] items-center justify-between gap-2 rounded-md border border-border bg-background px-2 text-xs text-foreground"
      >
        <span className="truncate text-left">
          {selected.length === 0 ? label : `${selected.length} selected`}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-lg">
            <div className="max-h-56 overflow-auto">
              {options.map((opt) => {
                const checked = selected.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      onChange(
                        checked
                          ? selected.filter((v) => v !== opt.value)
                          : [...selected, opt.value]
                      )
                    }
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
                  >
                    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-border bg-background">
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="mt-1 w-full rounded-sm px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
              >
                Clear assignees
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Main Page Component ── */

export default function SubtasksPage() {
  /* ── filter state ── */
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [csmFilter, setCsmFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState("");
  const [listFilter, setListFilter] = useState("");
  const [dueBefore, setDueBefore] = useState("");
  const [dueAfter, setDueAfter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // bump to force cache refresh

  /* ── Build URL ── */
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "25");
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (csmFilter) params.set("csm", csmFilter);
    if (assigneeFilter.length > 0) {
      for (const assignee of assigneeFilter) {
        params.append("assignee", assignee);
      }
    }
    if (priorityFilter) params.set("priority", priorityFilter);
    if (listFilter) params.set("list", listFilter);
    if (dueBefore) params.set("dueBefore", dueBefore);
    if (dueAfter) params.set("dueAfter", dueAfter);
    if (refreshKey > 0) params.set("refresh", "true");
    return `/api/subtasks?${params.toString()}`;
  }, [page, search, statusFilter, csmFilter, assigneeFilter, priorityFilter, listFilter, dueBefore, dueAfter, refreshKey]);

  /* ── SWR ── */
  const { data, error: swrError, isLoading, isValidating, mutate } = useSWR<SubtasksApiResponse>(
    apiUrl,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const tasks = data?.tasks ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? page;
  const availableCSMs = data?.availableCSMs ?? [];
  const availableLists = data?.availableLists ?? [];

  // Derive statuses/assignees from task data if the API didn't return them
  const availableStatuses: ClickUpStatus[] = useMemo(() => {
    if (data?.availableStatuses && data.availableStatuses.length > 0) {
      console.log("[v0] Available statuses from API:", data.availableStatuses.length);
      return data.availableStatuses;
    }
    // Fallback: derive from tasks
    const seen = new Map<string, ClickUpStatus>();
    for (const t of tasks) {
      const key = t.status.status.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, { status: t.status.status, color: t.status.color || "#64748b" });
      }
    }
    const derived = [...seen.values()];
    console.log("[v0] Derived statuses from tasks:", derived.length);
    return derived;
  }, [data?.availableStatuses, tasks]);

  const availableAssignees: ClickUpAssignee[] = useMemo(() => {
    if (data?.availableAssignees && data.availableAssignees.length > 0) {
      console.log("[v0] Available assignees from API:", data.availableAssignees.length);
      return [...data.availableAssignees].sort((a, b) =>
        a.username.localeCompare(b.username)
      );
    }
    // Fallback: derive from tasks
    const seen = new Map<number, ClickUpAssignee>();
    for (const t of tasks) {
      for (const a of t.assignees) {
        if (!seen.has(a.id)) {
          seen.set(a.id, { id: a.id, username: a.username, profilePicture: a.profilePicture });
        }
      }
    }
    const derived = [...seen.values()].sort((a, b) =>
      a.username.localeCompare(b.username)
    );
    console.log("[v0] Derived assignees from tasks:", derived.length);
    return derived;
  }, [data?.availableAssignees, tasks]);

  const assigneeFilterOptions = useMemo(() => {
    const map = new Map<string, string>();

    map.set("unassigned", "Unassigned");

    for (const a of availableAssignees) {
      map.set(a.username.toLowerCase(), a.username);
    }

    for (const selected of assigneeFilter) {
      if (!map.has(selected)) {
        map.set(selected, selected);
      }
    }

    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => {
        if (a.value === "unassigned") return -1;
        if (b.value === "unassigned") return 1;
        return a.label.localeCompare(b.label);
      });
  }, [availableAssignees, assigneeFilter]);

  // ClickUp fixed priorities
  const availablePriorities = useMemo(() => {
    return data?.availablePriorities ?? [
      { priority: "urgent", color: "#f50000" },
      { priority: "high", color: "#ffcc00" },
      { priority: "normal", color: "#6fddff" },
      { priority: "low", color: "#d8d8d8" },
    ];
  }, [data?.availablePriorities]);

  const hasData = data?.ok === true;
  const error = swrError?.message ?? "";
  const cachedAt = data?.cachedAt ? new Date(data.cachedAt) : null;

  /* ── Force refresh from ClickUp (bypass cache) ── */
  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  /* ── Update a task field via API ── */
  const [updating, setUpdating] = useState<string | null>(null);
  const handleTaskUpdate = useCallback(
    async (taskId: string, field: string, value: unknown) => {
      console.log("[v0] Updating task:", taskId, "field:", field, "value:", value);
      setUpdating(taskId);
      
      // Optimistically update the UI
      if (data?.tasks) {
        const optimisticTasks = data.tasks.map((t) => {
          if (t.id !== taskId) return t;
          
          const updated = { ...t };
          if (field === "status" && typeof value === "string") {
            // Find the proper-cased status name
            const statusObj = availableStatuses.find(
              (s) => s.status.toLowerCase() === value.toLowerCase()
            );
            if (statusObj) {
              console.log("[v0] Optimistic status update:", statusObj.status);
              updated.status = { status: statusObj.status, color: statusObj.color };
            }
          } else if (field === "assignee") {
            const ids = Array.isArray(value) ? value : value ? [value] : [];
            updated.assignees = ids
              .map((id) => availableAssignees.find((a) => a.id === Number(id)))
              .filter(Boolean) as ClickUpAssignee[];
            console.log("[v0] Optimistic assignee update:", updated.assignees.map(a => a.username));
          } else if (field === "priority" && typeof value === "string") {
            const priorityObj = availablePriorities.find(
              (p) => p.priority.toLowerCase() === value.toLowerCase()
            );
            if (priorityObj) {
              console.log("[v0] Optimistic priority update:", priorityObj.priority);
              updated.priority = { priority: priorityObj.priority, color: priorityObj.color };
            } else if (value.toLowerCase() === "none") {
              updated.priority = null;
            }
          } else if (field.startsWith("custom_field:")) {
            const fieldId = field.replace("custom_field:", "");
            if (updated.custom_fields) {
              updated.custom_fields = updated.custom_fields.map((cf) =>
                cf.id === fieldId ? { ...cf, value } : cf
              );
              console.log("[v0] Optimistic custom field update:", fieldId, value);
            }
          }
          return updated;
        });
        
        mutate({ ...data, tasks: optimisticTasks }, false);
      }
      
      try {
        const res = await fetch("/api/task/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, field, value }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Update failed");
        console.log("[v0] Task update successful");
        toast.success("Task updated");
        mutate(); // refresh data from server
      } catch (e: unknown) {
        console.error("[v0] Task update failed:", e);
        toast.error(e instanceof Error ? e.message : "Update failed");
        mutate(); // revert on error
      } finally {
        setUpdating(null);
      }
    },
    [mutate, data, availableStatuses, availableAssignees, availablePriorities]
  );

  /* ── Unique custom field names across current page tasks ── */
  const customFieldNames = useMemo(() => {
    const names = new Set<string>();
    for (const t of tasks) {
      for (const cf of t.custom_fields ?? []) {
        if (cf.name && cf.name.toLowerCase() !== "csm") names.add(cf.name);
      }
    }
    return [...names].sort();
  }, [tasks]);

  const activeFilterCount =
    [search, statusFilter, csmFilter, priorityFilter, listFilter, dueBefore, dueAfter].filter(Boolean)
      .length + assigneeFilter.length;
  const hasActiveFilters = activeFilterCount > 0;

  const clearAllFilters = useCallback(() => {
    setSearch("");
    setSearchInput("");
    setStatusFilter("");
    setCsmFilter("");
    setAssigneeFilter([]);
    setPriorityFilter("");
    setListFilter("");
    setDueBefore("");
    setDueAfter("");
    setPage(1);
  }, []);

  const applySearch = useCallback(() => {
    setSearch(searchInput);
    setPage(1);
  }, [searchInput]);

  /* ── Loading state ── */
  if (isLoading && !hasData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading subtasks...</p>
        </div>
      </div>
    );
  }

  /* ── Error state ── */
  if (error && !hasData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <X className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-card-foreground">
            Failed to load subtasks
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">{error}</p>
          <button
            onClick={handleRefresh}
            disabled={isValidating}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isValidating ? "animate-spin" : ""}`} />
            {isValidating ? "Retrying..." : "Retry"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-right" richColors />

      {/* ── Header ── */}
      <div className="sticky top-0 z-30 border-b border-border bg-background shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="hidden md:flex" />
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold text-foreground">Subtasks</h1>
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {total.toLocaleString()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {cachedAt && (
              <span className="text-xs text-muted-foreground">
                Synced {Math.round((Date.now() - cachedAt.getTime()) / 60_000)}m ago
              </span>
            )}
            {isValidating && (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            <button
              onClick={handleRefresh}
              disabled={isValidating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              title="Force re-sync from ClickUp"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sync from ClickUp
            </button>
          </div>
        </div>

        {/* ── Filter bar ── */}
        <div className="border-t border-border px-6 py-3">
          {/* Search + toggle filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by task or parent name..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applySearch()}
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {searchInput !== search && (
              <button
                onClick={applySearch}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Search
              </button>
            )}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                showFilters || hasActiveFilters
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-foreground hover:bg-accent"
              }`}
            >
              <Filter className="h-3.5 w-3.5" />
              Filters
              {hasActiveFilters && (
                <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Clear all
              </button>
            )}
          </div>

          {/* Expanded filter dropdowns */}
          {showFilters && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              {/* Status */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                >
                  <option value="">All statuses</option>
                  {availableStatuses.map((s) => (
                    <option key={s.status} value={s.status.toLowerCase()}>
                      {s.status}
                    </option>
                  ))}
                </select>
              </div>

              {/* CSM */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Top Parent CSM</label>
                <select
                  value={csmFilter}
                  onChange={(e) => { setCsmFilter(e.target.value); setPage(1); }}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                >
                  <option value="">All CSMs</option>
                  {availableCSMs.map((c) => (
                    <option key={c} value={c.toLowerCase()}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Assignee */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Assignee</label>
                <MultiSelectDropdown
                  label="All assignees"
                  options={assigneeFilterOptions}
                  selected={assigneeFilter}
                  onChange={(next) => {
                    setAssigneeFilter(next);
                    setPage(1);
                  }}
                />
              </div>

              {/* Priority */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Priority</label>
                <select
                  value={priorityFilter}
                  onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                >
                  <option value="">All priorities</option>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                  <option value="none">None</option>
                </select>
              </div>

              {/* List */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">List</label>
                <select
                  value={listFilter}
                  onChange={(e) => { setListFilter(e.target.value); setPage(1); }}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                >
                  <option value="">All lists</option>
                  {availableLists.map((l) => (
                    <option key={l} value={l.toLowerCase()}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>

              {/* Due After */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Due after</label>
                <input
                  type="date"
                  value={dueAfter}
                  onChange={(e) => { setDueAfter(e.target.value); setPage(1); }}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                />
              </div>

              {/* Due Before */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Due before</label>
                <input
                  type="date"
                  value={dueBefore}
                  onChange={(e) => { setDueBefore(e.target.value); setPage(1); }}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="px-6 pb-6">
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          {/* Table header controls */}
          <div className="flex items-center justify-between border-b border-border px-5 py-3 bg-card">
            <p className="text-xs text-muted-foreground">
              Showing {tasks.length > 0 ? ((currentPage - 1) * (data?.limit ?? 25) + 1) : 0}
              {" - "}
              {Math.min(currentPage * (data?.limit ?? 25), total)} of {total} subtasks
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="rounded-md border border-border p-1 transition-colors hover:bg-accent disabled:opacity-30"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="rounded-md border border-border p-1 transition-colors hover:bg-accent disabled:opacity-30"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="relative overflow-x-auto max-h-[calc(100vh-300px)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <tr className="bg-muted/40">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Top Parent Task
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Task Name
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Top Parent CSM
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Assignee
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Priority
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Due Date
                  </th>
                  {customFieldNames.map((name) => (
                    <th
                      key={name}
                      className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap"
                    >
                      {name}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Last Updated
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                    List
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10 + customFieldNames.length}
                      className="px-5 py-16 text-center text-muted-foreground"
                    >
                      {hasActiveFilters
                        ? "No subtasks match the current filters"
                        : "No subtasks found"}
                    </td>
                  </tr>
                ) : (
                  tasks.map((task) => (
                    <tr
                      key={task.id}
                      className="border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                    >
                      {/* Top Parent Task */}
                      <td className="max-w-[200px] truncate px-4 py-3 font-medium text-card-foreground">
                        {task._topParentName}
                      </td>

                      {/* Task Name */}
                      <td className="max-w-[240px] truncate px-4 py-3 text-card-foreground">
                        {task.url ? (
                          <a
                            href={task.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 hover:underline"
                          >
                            {task.name}
                            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                          </a>
                        ) : (
                          task.name
                        )}
                      </td>

                      {/* Top Parent CSM */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            task._topParentCSM === "N/A"
                              ? "bg-muted text-muted-foreground"
                              : "bg-primary/10 text-primary"
                          }`}
                        >
                          {task._topParentCSM}
                        </span>
                      </td>

                      {/* Status (editable) */}
                      <td className="px-4 py-3">
                        <InlineSelect
                          value={task.status.status.toLowerCase()}
                          options={availableStatuses.map((s) => ({
                            value: s.status.toLowerCase(),
                            label: s.status,
                            color: s.color,
                          }))}
                          onCommit={(v) => {
                            // Find the original status name with proper casing
                            const statusObj = availableStatuses.find(
                              (s) => s.status.toLowerCase() === v.toLowerCase()
                            );
                            if (statusObj) {
                              handleTaskUpdate(task.id, "status", statusObj.status);
                            }
                          }}
                          disabled={updating === task.id}
                          renderValue={(v) => {
                            // Find the status to get the proper label
                            const statusObj = availableStatuses.find(
                              (s) => s.status.toLowerCase() === v.toLowerCase()
                            );
                            return <StatusBadge status={statusObj?.status ?? v} />;
                          }}
                        />
                      </td>

                      {/* Assignee (editable) */}
                      <td className="px-4 py-3">
                        <InlineSelect
                          value={task.assignees[0]?.id?.toString() ?? "unassigned"}
                          options={[
                            { value: "unassigned", label: "Unassigned" },
                            ...availableAssignees.map((a) => ({
                              value: String(a.id),
                              label: a.username,
                            })),
                          ]}
                          onCommit={(v) =>
                            handleTaskUpdate(
                              task.id,
                              "assignee",
                              v === "unassigned" ? [] : [Number(v)]
                            )
                          }
                          disabled={updating === task.id}
                        />
                      </td>

                      {/* Priority (editable) */}
                      <td className="px-4 py-3">
                        <InlineSelect
                          value={task.priority?.priority?.toLowerCase() ?? "none"}
                          options={[
                            { value: "none", label: "None" },
                            ...availablePriorities.map((p) => ({
                              value: p.priority.toLowerCase(),
                              label: p.priority.charAt(0).toUpperCase() + p.priority.slice(1),
                              color: p.color,
                            })),
                          ]}
                          onCommit={(v) => {
                            // Find the original priority name with proper casing
                            if (v === "none") {
                              handleTaskUpdate(task.id, "priority", "none");
                            } else {
                              const priorityObj = availablePriorities.find(
                                (p) => p.priority.toLowerCase() === v.toLowerCase()
                              );
                              if (priorityObj) {
                                handleTaskUpdate(task.id, "priority", priorityObj.priority);
                              }
                            }
                          }}
                          disabled={updating === task.id}
                          renderValue={(v) => {
                            if (v === "none") return <span className="text-muted-foreground text-xs">--</span>;
                            const priorityObj = availablePriorities.find(
                              (p) => p.priority.toLowerCase() === v.toLowerCase()
                            );
                            return <PriorityBadge priority={priorityObj ? { priority: priorityObj.priority, color: priorityObj.color } : null} />;
                          }}
                        />
                      </td>

                      {/* Due Date */}
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(task.due_date)}
                      </td>

                      {/* Custom Fields */}
                      {customFieldNames.map((name) => {
                        const cf = task.custom_fields?.find((f) => f.name === name);
                        
                        // Make drop_down custom fields editable
                        if (cf?.type === "drop_down" && cf.type_config?.options && cf.type_config.options.length > 0) {
                          return (
                            <td key={name} className="px-4 py-3 text-card-foreground text-xs whitespace-nowrap">
                              <InlineSelect
                                value={String(cf.value ?? "")}
                                options={cf.type_config.options.map((opt) => ({
                                  value: String(opt.orderindex),
                                  label: opt.name || opt.label || String(opt.orderindex),
                                }))}
                                onCommit={(v) => {
                                  handleTaskUpdate(task.id, `custom_field:${cf.id}`, Number(v));
                                }}
                                disabled={updating === task.id}
                                renderValue={(v) => {
                                  const opt = cf.type_config!.options!.find((o) => String(o.orderindex) === v);
                                  return <span>{opt?.name || opt?.label || "--"}</span>;
                                }}
                              />
                            </td>
                          );
                        }
                        
                        return (
                          <td key={name} className="px-4 py-3 text-card-foreground text-xs whitespace-nowrap">
                            {cf ? <CustomFieldValue field={cf} /> : <span className="text-muted-foreground">--</span>}
                          </td>
                        );
                      })}

                      {/* Last Updated */}
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="tabular-nums">{formatRelative(task.date_updated)}</span>
                        <span className="ml-1.5 text-[10px] text-muted-foreground/60">
                          {formatDate(task.date_updated)}
                        </span>
                      </td>

                      {/* List */}
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {task.list?.name || "--"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

        </div>

        {/* Pagination -- outside the card, left-aligned below table */}
        <div className="flex flex-wrap items-center gap-3 pt-4">
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString()} subtasks
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(1)}
              disabled={currentPage <= 1}
              className="rounded-md border border-border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-30"
            >
              First
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 1 && val <= totalPages) setPage(val);
              }}
              className="h-7 w-14 rounded-md border border-border bg-background text-center text-xs text-foreground"
            />
            <span className="text-xs text-muted-foreground">/ {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-30"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={currentPage >= totalPages}
              className="rounded-md border border-border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-30"
            >
              Last
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
