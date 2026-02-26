"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Toaster, toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  LayoutDashboard,
  Clock,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Users,
  ListChecks,
  Pause,
  TrendingUp,
  ShieldAlert,
  UserX,
  Shield,
  Flame,
} from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { TaskRow } from "@/components/task-row";
import type {
  ClickUpTask,
  ClickUpStatus,
  ClickUpAssignee,
  EnhancedApiResponse,
} from "@/lib/types";

/* ────────────────────────── types ────────────────────────── */

interface LocalClickUpTask {
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
  custom_fields?: { id: string; name: string; type: string; value?: unknown; type_config?: { options?: { id: string; name: string; label?: string; color?: string; orderindex?: number }[] } }[];
  subtasks?: LocalClickUpTask[];
}

/* ────────────────────────── palette ────────────────────────── */

const CHART_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#ec4899",
  "#14b8a6",
  "#6366f1",
];

const STATUS_COLOR_MAP: Record<string, string> = {
  "to do": "#94a3b8",
  open: "#94a3b8",
  "not started": "#94a3b8",
  "in progress": "#3b82f6",
  "in review": "#8b5cf6",
  complete: "#10b981",
  done: "#10b981",
  closed: "#10b981",
  stuck: "#ef4444",
  blocked: "#ef4444",
};

const STATUS_BUCKET_COLORS: Record<string, string> = {
  "Not Started": "#94a3b8",
  "In Progress": "#3b82f6",
  Stuck: "#ef4444",
  Complete: "#10b981",
  Other: "#8b5cf6",
};

function getStatusColor(status: string) {
  return STATUS_COLOR_MAP[status.toLowerCase()] || "#64748b";
}

/* ── SWR fetcher (throws on HTTP or API-level errors so SWR sees them) ── */

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = json?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (json && !json.ok) {
    throw new Error(json.error || "API returned an error");
  }
  return json;
};

function getStatusBucket(status: string): string {
  const s = status.toLowerCase().trim();
  if (
    s === "to do" ||
    s === "open" ||
    s === "not started" ||
    s === "backlog" ||
    s === "pending"
  )
    return "Not Started";
  if (
    s === "in progress" ||
    s === "in review" ||
    s === "active" ||
    s === "in development"
  )
    return "In Progress";
  if (s === "stuck" || s === "blocked" || s === "on hold") return "Stuck";
  if (
    s === "complete" ||
    s === "completed" ||
    s === "done" ||
    s === "closed" ||
    s === "resolved" ||
    s === "finished"
  )
    return "Complete";
  return "Other";
}

/* ────────────────────────── helpers ────────────────────────── */

const NOW = Date.now();
const ONE_DAY = 86400000;

function inactiveDays(task: LocalClickUpTask): number {
  const updated = Number(task.date_updated);
  if (!updated || isNaN(updated)) return 0;
  return Math.floor((NOW - updated) / ONE_DAY);
}

function formatDate(ts: string | null | undefined) {
  if (!ts) return "\u2014";
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return "\u2014";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(ts: string | null | undefined) {
  if (!ts) return "\u2014";
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return "\u2014";
  const days = Math.floor((NOW - d.getTime()) / ONE_DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function getAssignee(task: LocalClickUpTask) {
  return task.assignees?.[0]?.username || "Unassigned";
}

function getAssigneeNames(task: LocalClickUpTask): string[] {
  if (!task.assignees?.length) return ["Unassigned"];
  return [...new Set(task.assignees.map((a) => a.username))];
}

function getListName(task: LocalClickUpTask) {
  return task.list?.name || task.list?.id || "Unknown";
}

/* ── risk helpers ── */

function computeRiskScore(metrics: {
  stuck: number;
  notStarted: number;
  inactive14: number;
  unassigned: number;
}): number {
  return (
    2 * metrics.stuck +
    1 * metrics.notStarted +
    1.5 * metrics.inactive14 +
    2 * metrics.unassigned
  );
}

function getRiskLevel(score: number): {
  label: string;
  bg: string;
  text: string;
} {
  if (score >= 25)
    return { label: "High", bg: "bg-red-500/15", text: "text-red-600" };
  if (score >= 10)
    return {
      label: "Medium",
      bg: "bg-orange-500/15",
      text: "text-orange-600",
    };
  return { label: "Low", bg: "bg-emerald-500/15", text: "text-emerald-600" };
}

function getTaskRiskFlags(task: LocalClickUpTask): string[] {
  const flags: string[] = [];
  if (getStatusBucket(task.status.status) === "Stuck") flags.push("Stuck");
  if (inactiveDays(task) >= 14) flags.push("Inactive 14d+");
  if (
    getStatusBucket(task.status.status) === "Not Started" &&
    inactiveDays(task) >= 7
  )
    flags.push("Not Started 7d+");
  if (getAssignee(task) === "Unassigned") flags.push("Unassigned");
  return flags;
}

function getTriggerReasons(task: LocalClickUpTask): string[] {
  const reasons: string[] = [];
  const bucket = getStatusBucket(task.status.status);
  const days = inactiveDays(task);
  if (bucket === "Stuck") reasons.push("Stuck");
  if (bucket === "Not Started" && days >= 7) reasons.push("Not Started 7d+");
  if (days >= 14) reasons.push("Inactive 14d+");
  if (getAssignee(task) === "Unassigned") reasons.push("Unassigned");
  return reasons;
}

const PAGE_SIZE = 15;

/* ────────────────────────── filter badge ────────────────────────── */

function FilterBadge({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded-sm hover:bg-primary/20"
        aria-label={`Remove filter ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/* ────────────────────────── multi select dropdown ────────────────────────── */

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-card-foreground shadow-sm transition-colors hover:bg-accent"
      >
        <span className="text-muted-foreground">{label}</span>
        {selected.length > 0 && (
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
            {selected.length}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 max-h-60 w-56 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
            {options.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No options
              </p>
            )}
            {options.map((opt) => {
              const checked = selected.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() =>
                    onChange(
                      checked
                        ? selected.filter((s) => s !== opt)
                        : [...selected, opt]
                    )
                  }
                  className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {checked && (
                      <svg
                        viewBox="0 0 12 12"
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </span>
                  <span className="truncate text-popover-foreground">{opt}</span>
                </button>
              );
            })}
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="mt-1 w-full rounded-md px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent"
              >
                Clear all
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ────────────────────────── KPI card ────────────────────────── */

function KPICard({
  title,
  value,
  color,
  total,
  icon: Icon,
}: {
  title: string;
  value: number;
  color: string;
  total: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}18` }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color }} />
        </div>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold tabular-nums text-card-foreground">
          {value.toLocaleString()}
        </span>
        <span className="mb-0.5 text-[11px] font-medium" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-muted">
        <div
          className="h-1 rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(parseFloat(pct), 100)}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

/* ── small aging bucket card ── */

function AgingCard({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div
      className="flex flex-col items-center rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <span
        className="text-lg font-bold tabular-nums"
        style={{ color }}
      >
        {count}
      </span>
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

/* ────────────────────────── enhanced chart tooltip ────────────────────────── */

function ChartTooltipContent({
  active,
  payload,
  label,
  totalForPercent,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
  totalForPercent?: number;
}) {
  if (!active || !payload?.length) return null;
  const sumValue = payload.reduce(
    (s, p) => s + (typeof p.value === "number" ? p.value : 0),
    0
  );
  const denominator = totalForPercent || sumValue;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      {label && (
        <p className="mb-1.5 max-w-[220px] font-medium text-popover-foreground">
          {label}
        </p>
      )}
      {payload.map((p, i) => {
        const pct =
          denominator > 0
            ? ((p.value / denominator) * 100).toFixed(1)
            : "0";
        return (
          <div
            key={i}
            className="flex items-center gap-2 py-0.5 text-popover-foreground"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor: p.color || p.fill || CHART_COLORS[0],
              }}
            />
            <span className="text-muted-foreground">
              {p.name || p.dataKey}:
            </span>
            <span className="font-medium">{p.value}</span>
            <span className="text-muted-foreground/70">({pct}%)</span>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────── pie label ───────────────────────── */

function renderPieLabel({
  name,
  percent,
}: {
  name: string;
  percent: number;
}) {
  if (percent < 0.04) return null;
  return `${name} (${(percent * 100).toFixed(0)}%)`;
}

/* ───────────────────────── Y-Axis full-name tick ───────────────────────── */

function FullNameTick({
  x,
  y,
  payload,
}: {
  x: number;
  y: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}) {
  const text: string = payload?.value ?? "";
  const display = text.length > 18 ? text.slice(0, 18) + "\u2026" : text;
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{text}</title>
      <text
        x={0}
        y={0}
        dy={4}
        textAnchor="end"
        fill="currentColor"
        className="text-muted-foreground"
        fontSize={11}
      >
        {display}
      </text>
    </g>
  );
}

/* ───────────────────────── collapsible section ───────────────────────── */

function CollapsibleSection({
  title,
  icon: Icon,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="mb-6 rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-muted/30"
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-card-foreground">{title}</h3>
        {badge}
        <span className="ml-auto">
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </section>
  );
}

/* ───────────────────────── CSM metrics type ───────────────────────── */

interface CSMMetrics {
  csm: string;
  total: number;
  stuck: number;
  notStarted: number;
  inProgress: number;
  complete: number;
  inactive14: number;
  unassigned: number;
  riskScore: number;
  tasks: LocalClickUpTask[];
}

/* ───────────────────────── CSM card ───────────────────────── */

function CSMCard({
  data,
  onSelect,
}: {
  data: CSMMetrics;
  onSelect: (csm: string) => void;
}) {
  const risk = getRiskLevel(data.riskScore);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-xs font-bold text-muted-foreground">
            {data.csm.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-card-foreground">
              {data.csm}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {data.total} task{data.total !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            Stuck:{" "}
            <span className="font-semibold text-card-foreground">
              {data.stuck}
            </span>
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            Not Started:{" "}
            <span className="font-semibold text-card-foreground">
              {data.notStarted}
            </span>
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-orange-500" />
            {"Inactive 14d+: "}
            <span className="font-semibold text-card-foreground">
              {data.inactive14}
            </span>
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Unassigned:{" "}
            <span className="font-semibold text-card-foreground">
              {data.unassigned}
            </span>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Risk Score
            </p>
            <p className="text-lg font-bold tabular-nums text-card-foreground">
              {data.riskScore.toFixed(1)}
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${risk.bg} ${risk.text}`}
          >
            {risk.label}
          </span>
          <button
            type="button"
            onClick={() => onSelect(data.csm)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-card-foreground transition-colors hover:bg-accent"
          >
            View Tasks
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Drawer panel ───────────────────────── */

function CSMDrawer({
  csm,
  tasks,
  onClose,
}: {
  csm: string;
  tasks: LocalClickUpTask[];
  onClose: () => void;
}) {
  const sorted = useMemo(
    () => [...tasks].sort((a, b) => inactiveDays(b) - inactiveDays(a)),
    [tasks]
  );

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-border bg-card shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              CSM Drill-Down
            </p>
            <h2 className="text-base font-semibold text-card-foreground">
              {csm}
            </h2>
            <p className="text-xs text-muted-foreground">
              {sorted.length} task{sorted.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Close drawer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-muted/60">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Task Name
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                  Inactive
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Last Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((task) => {
                const days = inactiveDays(task);
                const isStuck =
                  getStatusBucket(task.status.status) === "Stuck";
                const isHighlight = isStuck || days >= 14;
                return (
                  <tr
                    key={task.id}
                    className={`border-b border-border transition-colors last:border-0 ${
                      isHighlight
                        ? "bg-red-500/5 hover:bg-red-500/10"
                        : "hover:bg-muted/20"
                    }`}
                  >
                    <td className="max-w-[180px] truncate px-4 py-2.5 font-medium text-card-foreground">
                      {task.url ? (
                        <a
                          href={task.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {task.name}
                        </a>
                      ) : (
                        task.name
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          backgroundColor: `${getStatusColor(task.status.status)}18`,
                          color: getStatusColor(task.status.status),
                        }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            backgroundColor: getStatusColor(
                              task.status.status
                            ),
                          }}
                        />
                        {task.status.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span
                        className={
                          days >= 14
                            ? "font-bold text-red-600"
                            : days >= 7
                            ? "font-semibold text-orange-600"
                            : "text-muted-foreground"
                        }
                      >
                        {days}d
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {formatRelative(task.date_updated)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </aside>
    </>
  );
}

/* ── status badge render helper ── */

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `${getStatusColor(status)}18`,
        color: getStatusColor(status),
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: getStatusColor(status) }}
      />
      {status}
    </span>
  );
}

/* ── trigger reason badge ── */

const TRIGGER_STYLES: Record<string, string> = {
  Stuck: "bg-red-500/15 text-red-600",
  "Not Started 7d+": "bg-slate-500/15 text-slate-600",
  "Inactive 14d+": "bg-orange-500/15 text-orange-600",
  Unassigned: "bg-amber-500/15 text-amber-600",
};

function TriggerBadges({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return <span className="text-muted-foreground">--</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {reasons.map((r) => (
        <span
          key={r}
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${TRIGGER_STYLES[r] || "bg-muted text-muted-foreground"}`}
        >
          {r}
        </span>
      ))}
    </div>
  );
}

/* ══════════════════════════ MAIN ══════════════════════════ */

export default function DashboardPage() {
  /* ── SWR data ── */
  const { data: apiData, error: swrError, isLoading: loading, isValidating: refreshing, mutate } = useSWR<EnhancedApiResponse>(
    "/api/tasks",
    fetcher,
    { revalidateOnFocus: false }
  );

  const tasks: LocalClickUpTask[] = (apiData?.ok ? apiData.tasks : []) as LocalClickUpTask[];
  const availableStatuses: ClickUpStatus[] = (apiData as EnhancedApiResponse)?.availableStatuses ?? [];
  const availableAssignees: ClickUpAssignee[] = (apiData as EnhancedApiResponse)?.availableAssignees ?? [];
  const error = swrError?.message ?? "";
  const lastRefreshed = apiData?.ok ? new Date() : null;
  const hasData = apiData?.ok === true;

  const [updating, setUpdating] = useState(false);

  /* ── filter state ── */
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [listFilter, setListFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [inactiveThreshold, setInactiveThreshold] = useState<number>(0);
  const [page, setPage] = useState(1);

  /* ── drawer state ── */
  const [drawerCSM, setDrawerCSM] = useState<string | null>(null);

  /* ── fetch helper (for refresh button) ── */
  const fetchTasks = useCallback(async () => {
    mutate();
  }, [mutate]);

  /* ── custom field names from tasks ── */
  const customFieldNames = useMemo(() => {
    const names = new Set<string>();
    for (const t of tasks) {
      for (const cf of t.custom_fields ?? []) {
        if (cf.name) names.add(cf.name);
      }
    }
    return [...names].sort();
  }, [tasks]);

  /* ── update handler with optimistic UI ── */
  const handleTaskUpdate = useCallback(
    async (taskId: string, field: string, value: unknown) => {
      setUpdating(true);
      const prevData = apiData;

      // Optimistic update: update local tasks
      if (apiData?.ok) {
        const optimistic = { ...apiData };
        const updateInList = (list: LocalClickUpTask[]): LocalClickUpTask[] =>
          list.map((t) => {
            if (t.id === taskId) {
              const updated = { ...t } as LocalClickUpTask;
              if (field === "status") {
                updated.status = { ...t.status, status: String(value) };
              }
              return updated;
            }
            if (t.subtasks?.length) {
              return { ...t, subtasks: updateInList(t.subtasks) } as LocalClickUpTask;
            }
            return t;
          });
        optimistic.tasks = updateInList(optimistic.tasks as LocalClickUpTask[]) as ClickUpTask[];
        mutate(optimistic as EnhancedApiResponse, false);
      }

      try {
        const res = await fetch("/api/task/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, field, value }),
        });
        const json = await res.json();
        if (!json.ok) {
          throw new Error(json.error || "Update failed");
        }
        toast.success("Task updated");
        mutate(); // revalidate
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Update failed");
        // Rollback
        if (prevData) mutate(prevData as EnhancedApiResponse, false);
      } finally {
        setUpdating(false);
      }
    },
    [apiData, mutate]
  );

  /* ── derived option sets ── */
  const allStatuses = useMemo(
    () => [...new Set(tasks.map((t) => t.status.status))].sort(),
    [tasks]
  );
  const allAssignees = useMemo(
    () => [...new Set(tasks.flatMap(getAssigneeNames))].sort(),
    [tasks]
  );
  const allLists = useMemo(
    () => [...new Set(tasks.map(getListName))].sort(),
    [tasks]
  );

  /* ── filtered tasks ── */
  const filtered = useMemo(() => {
    let result = tasks;

    if (statusFilter.length > 0)
      result = result.filter((t) => statusFilter.includes(t.status.status));

    if (assigneeFilter.length > 0)
      result = result.filter((t) => {
        const assignees = getAssigneeNames(t);
        return assigneeFilter.some((selected) => assignees.includes(selected));
      });

    if (listFilter.length > 0)
      result = result.filter((t) => listFilter.includes(getListName(t)));

    if (inactiveThreshold > 0)
      result = result.filter((t) => inactiveDays(t) >= inactiveThreshold);

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((t) => t.name.toLowerCase().includes(q));
    }

    return result;
  }, [
    tasks,
    statusFilter,
    assigneeFilter,
    listFilter,
    inactiveThreshold,
    search,
  ]);

  /* ── KPI values ── */
  const kpis = useMemo(() => {
    let notStarted = 0;
    let inProgress = 0;
    let stuck = 0;
    let complete = 0;
    let unassigned = 0;
    let inactive7 = 0;
    let inactive14 = 0;

    for (const t of filtered) {
      const bucket = getStatusBucket(t.status.status);
      if (bucket === "Not Started") notStarted++;
      else if (bucket === "In Progress") inProgress++;
      else if (bucket === "Stuck") stuck++;
      else if (bucket === "Complete") complete++;

      if (getAssignee(t) === "Unassigned") unassigned++;

      const days = inactiveDays(t);
      if (days >= 7) inactive7++;
      if (days >= 14) inactive14++;
    }

    const completionRate =
      filtered.length > 0
        ? ((complete / filtered.length) * 100).toFixed(1)
        : "0";

    return {
      total: filtered.length,
      notStarted,
      inProgress,
      stuck,
      complete,
      unassigned,
      inactive7,
      inactive14,
      completionRate,
    };
  }, [filtered]);

  /* ── aging buckets ── */
  const agingBuckets = useMemo(() => {
    let d0_2 = 0;
    let d3_6 = 0;
    let d7_13 = 0;
    let d14plus = 0;
    for (const t of filtered) {
      const days = inactiveDays(t);
      if (days <= 2) d0_2++;
      else if (days <= 6) d3_6++;
      else if (days <= 13) d7_13++;
      else d14plus++;
    }
    return { d0_2, d3_6, d7_13, d14plus };
  }, [filtered]);

  /* ── aggregations for charts ── */
  const byStatus = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of filtered) {
      const s = t.status.status;
      map[s] = (map[s] || 0) + 1;
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  /* stacked status by CSM/List */
  const stackedByCSM = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const t of filtered) {
      const csm = getListName(t);
      const bucket = getStatusBucket(t.status.status);
      if (!map[csm]) map[csm] = {};
      map[csm][bucket] = (map[csm][bucket] || 0) + 1;
    }
    return Object.entries(map)
      .map(([name, buckets]) => ({
        name,
        ...buckets,
        _total: Object.values(buckets).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b._total - a._total)
      .slice(0, 10);
  }, [filtered]);

  /* inactive 14+ by CSM */
  const inactive14ByCSM = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of filtered) {
      if (inactiveDays(t) >= 14) {
        const csm = getListName(t);
        map[csm] = (map[csm] || 0) + 1;
      }
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filtered]);

  /* stuck by CSM */
  const stuckByCSM = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of filtered) {
      if (getStatusBucket(t.status.status) === "Stuck") {
        const csm = getListName(t);
        map[csm] = (map[csm] || 0) + 1;
      }
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filtered]);

  /* ── CSM drill-down metrics ── */
  const csmMetrics: CSMMetrics[] = useMemo(() => {
    const map: Record<
      string,
      {
        total: number;
        stuck: number;
        notStarted: number;
        inProgress: number;
        complete: number;
        inactive14: number;
        unassigned: number;
        tasks: ClickUpTask[];
      }
    > = {};

    for (const t of filtered) {
      const csm = getListName(t);
      if (!map[csm])
        map[csm] = {
          total: 0,
          stuck: 0,
          notStarted: 0,
          inProgress: 0,
          complete: 0,
          inactive14: 0,
          unassigned: 0,
          tasks: [],
        };
      map[csm].total++;
      map[csm].tasks.push(t);

      const bucket = getStatusBucket(t.status.status);
      if (bucket === "Stuck") map[csm].stuck++;
      if (bucket === "Not Started") map[csm].notStarted++;
      if (bucket === "In Progress") map[csm].inProgress++;
      if (bucket === "Complete") map[csm].complete++;
      if (inactiveDays(t) >= 14) map[csm].inactive14++;
      if (getAssignee(t) === "Unassigned") map[csm].unassigned++;
    }

    return Object.entries(map)
      .map(([csm, d]) => ({
        csm,
        ...d,
        riskScore: computeRiskScore(d),
      }))
      .sort((a, b) => b.riskScore - a.riskScore);
  }, [filtered]);

  /* ── CSM lookup for drawer ── */
  const drawerData = useMemo(() => {
    if (!drawerCSM) return null;
    return csmMetrics.find((c) => c.csm === drawerCSM) || null;
  }, [drawerCSM, csmMetrics]);

  /* ── critical action board ── */
  const criticalTasks = useMemo(() => {
    return filtered
      .filter((t) => {
        const bucket = getStatusBucket(t.status.status);
        const days = inactiveDays(t);
        return (
          bucket === "Stuck" ||
          days >= 14 ||
          (bucket === "Not Started" && days >= 7)
        );
      })
      .map((t) => {
        const bucket = getStatusBucket(t.status.status);
        const days = inactiveDays(t);
        let weight = 0;
        if (bucket === "Stuck") weight += 2;
        if (days >= 14) weight += 1.5;
        if (bucket === "Not Started") weight += 1;
        if (getAssignee(t) === "Unassigned") weight += 2;
        return { task: t, weight };
      })
      .sort((a, b) => b.weight - a.weight);
  }, [filtered]);

  /* ── risk table ── */
  const riskTable = useMemo(() => {
    return csmMetrics.slice(0, 15);
  }, [csmMetrics]);

  /* ── pagination ── */
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedTasks = useMemo(
    () =>
      filtered.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE
      ),
    [filtered, currentPage]
  );

  useEffect(() => {
    setPage(1);
  }, [statusFilter, assigneeFilter, listFilter, inactiveThreshold, search]);

  /* ── active filter count ── */
  const activeFilterCount =
    statusFilter.length +
    assigneeFilter.length +
    listFilter.length +
    (inactiveThreshold > 0 ? 1 : 0) +
    (search ? 1 : 0);

  const clearAllFilters = () => {
    setStatusFilter([]);
    setAssigneeFilter([]);
    setListFilter([]);
    setInactiveThreshold(0);
    setSearch("");
  };

  const BUCKET_KEYS = [
    "Not Started",
    "In Progress",
    "Stuck",
    "Complete",
    "Other",
  ] as const;

  /* ── bar click handler (opens drawer) ── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleBarClick = (data: any) => {
    if (data?.activeLabel) setDrawerCSM(data.activeLabel);
    else if (data?.name) setDrawerCSM(data.name);
  };

  /* ══════════════════════ RENDER ══════════════════════ */

  /* ── Loading state (only on first load, not on refetch) ── */
  if (loading && !hasData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  /* ── Error state (no data yet) ── */
  if (error && !hasData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <X className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-card-foreground">
            Failed to load tasks
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => mutate()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Retrying..." : "Retry"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-right" richColors />
      {/* ── drawer ── */}
      {drawerCSM && drawerData && (
        <CSMDrawer
          csm={drawerCSM}
          tasks={drawerData.tasks}
          onClose={() => setDrawerCSM(null)}
        />
      )}

      {/* ── header ── */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
  <SidebarTrigger className="hidden md:flex" />
  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
  <LayoutDashboard className="h-4 w-4 text-primary-foreground" />
  </div>
            <div>
              <h1 className="text-base font-semibold leading-tight text-card-foreground">
                ClickUp Dashboard
              </h1>
              {lastRefreshed && (
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {"Updated "}
                  {lastRefreshed.toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => fetchTasks()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-6 py-6">
        {/* ── KPI cards ── */}
        <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <KPICard
            title="Total Tasks"
            value={kpis.total}
            color="#3b82f6"
            total={tasks.length}
            icon={ListChecks}
          />
          <KPICard
            title="Not Started"
            value={kpis.notStarted}
            color="#94a3b8"
            total={kpis.total}
            icon={Pause}
          />
          <KPICard
            title="In Progress"
            value={kpis.inProgress}
            color="#3b82f6"
            total={kpis.total}
            icon={TrendingUp}
          />
          <KPICard
            title="Stuck"
            value={kpis.stuck}
            color="#ef4444"
            total={kpis.total}
            icon={AlertTriangle}
          />
          <KPICard
            title="Completion"
            value={kpis.complete}
            color="#10b981"
            total={kpis.total}
            icon={ListChecks}
          />
          <KPICard
            title="Unassigned"
            value={kpis.unassigned}
            color="#f59e0b"
            total={kpis.total}
            icon={UserX}
          />
          <KPICard
            title="Inactive 7d+"
            value={kpis.inactive7}
            color="#f97316"
            total={kpis.total}
            icon={Clock}
          />
          <KPICard
            title="Inactive 14d+"
            value={kpis.inactive14}
            color="#ef4444"
            total={kpis.total}
            icon={ShieldAlert}
          />
        </section>

        {/* ── filters ── */}
        <section className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <MultiSelect
              label="Status"
              options={allStatuses}
              selected={statusFilter}
              onChange={setStatusFilter}
            />
            <MultiSelect
              label="Assignee"
              options={allAssignees}
              selected={assigneeFilter}
              onChange={setAssigneeFilter}
            />
            <MultiSelect
              label="List"
              options={allLists}
              selected={listFilter}
              onChange={setListFilter}
            />

            {/* inactive threshold */}
            <div className="flex items-center gap-1.5">
              <label
                className="text-xs text-muted-foreground"
                htmlFor="inactiveThreshold"
              >
                Inactive
              </label>
              <select
                id="inactiveThreshold"
                value={inactiveThreshold}
                onChange={(e) => setInactiveThreshold(Number(e.target.value))}
                className="h-9 rounded-lg border border-border bg-card px-2 pr-8 text-sm text-card-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value={0}>All</option>
                <option value={7}>{"7+ days"}</option>
                <option value={14}>{"14+ days"}</option>
                <option value={30}>{"30+ days"}</option>
              </select>
            </div>

            {/* search */}
            <div className="relative ml-auto">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search tasks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-sm text-card-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">Filters:</span>
              {statusFilter.map((s) => (
                <FilterBadge
                  key={`s-${s}`}
                  label={s}
                  onRemove={() =>
                    setStatusFilter(statusFilter.filter((x) => x !== s))
                  }
                />
              ))}
              {assigneeFilter.map((a) => (
                <FilterBadge
                  key={`a-${a}`}
                  label={a}
                  onRemove={() =>
                    setAssigneeFilter(assigneeFilter.filter((x) => x !== a))
                  }
                />
              ))}
              {listFilter.map((l) => (
                <FilterBadge
                  key={`l-${l}`}
                  label={l}
                  onRemove={() =>
                    setListFilter(listFilter.filter((x) => x !== l))
                  }
                />
              ))}
              {inactiveThreshold > 0 && (
                <FilterBadge
                  label={`Inactive ${inactiveThreshold}d+`}
                  onRemove={() => setInactiveThreshold(0)}
                />
              )}
              {search && (
                <FilterBadge
                  label={`"${search}"`}
                  onRemove={() => setSearch("")}
                />
              )}
              <button
                onClick={clearAllFilters}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Clear all
              </button>
            </div>
          )}
        </section>

        {/* ── charts row 1: donut + stacked bar ── */}
        <section className="mb-6 grid gap-4 lg:grid-cols-3">
          {/* status donut */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-card-foreground">
              Status Distribution
            </h3>
            {byStatus.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No data
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={byStatus}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    label={renderPieLabel}
                    fontSize={11}
                  >
                    {byStatus.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={getStatusColor(entry.name)}
                        stroke="none"
                      />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    content={
                      <ChartTooltipContent
                        totalForPercent={filtered.length}
                      />
                    }
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* stacked bar: status by CSM */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
            <h3 className="mb-4 text-sm font-semibold text-card-foreground">
              Status Breakdown by CSM / List
            </h3>
            {stackedByCSM.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No data
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={stackedByCSM}
                  layout="vertical"
                  margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                  onClick={handleBarClick}
                  style={{ cursor: "pointer" }}
                >
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={FullNameTick}
                  />
                  <RechartsTooltip content={<ChartTooltipContent />} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                  {BUCKET_KEYS.map((bucket) => (
                    <Bar
                      key={bucket}
                      dataKey={bucket}
                      stackId="status"
                      fill={STATUS_BUCKET_COLORS[bucket]}
                      maxBarSize={22}
                      radius={0}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ── charts row 2: inactive 14d + stuck by CSM ── */}
        <section className="mb-6 grid gap-4 lg:grid-cols-2">
          {/* inactive 14+ by CSM */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-card-foreground">
              {"Inactive 14+ Days by CSM / List"}
            </h3>
            {inactive14ByCSM.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No inactive tasks found
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={inactive14ByCSM}
                  layout="vertical"
                  margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                  onClick={handleBarClick}
                  style={{ cursor: "pointer" }}
                >
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={FullNameTick}
                  />
                  <RechartsTooltip
                    content={
                      <ChartTooltipContent
                        totalForPercent={kpis.inactive14}
                      />
                    }
                  />
                  <Bar
                    dataKey="value"
                    name="Inactive 14d+"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={20}
                  >
                    {inactive14ByCSM.map((_, i) => (
                      <Cell key={i} fill="#f97316" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* stuck by CSM */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-card-foreground">
              Stuck Tasks by CSM / List
            </h3>
            {stuckByCSM.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No stuck tasks found
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={stuckByCSM}
                  layout="vertical"
                  margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                  onClick={handleBarClick}
                  style={{ cursor: "pointer" }}
                >
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={FullNameTick}
                  />
                  <RechartsTooltip
                    content={
                      <ChartTooltipContent totalForPercent={kpis.stuck} />
                    }
                  />
                  <Bar
                    dataKey="value"
                    name="Stuck"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={20}
                  >
                    {stuckByCSM.map((_, i) => (
                      <Cell key={i} fill="#ef4444" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ── Top Risky CSMs table ── */}
        <section className="mb-6 rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-semibold text-card-foreground">
              Top Risky CSMs
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {"Risk = (2 \u00D7 Stuck) + (1 \u00D7 Not Started) + (1.5 \u00D7 Inactive 14d+) + (2 \u00D7 Unassigned)"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">
                    CSM / List
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">
                    Total
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">
                    Stuck
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">
                    Not Started
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">
                    {"Inactive 14d+"}
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">
                    Unassigned
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">
                    Risk Score
                  </th>
                  <th className="px-5 py-2.5 text-center font-medium text-muted-foreground">
                    Level
                  </th>
                </tr>
              </thead>
              <tbody>
                {riskTable.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-5 py-8 text-center text-muted-foreground"
                    >
                      No data
                    </td>
                  </tr>
                ) : (
                  riskTable.map((row, i) => {
                    const risk = getRiskLevel(row.riskScore);
                    return (
                      <tr
                        key={row.csm}
                        className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                        onClick={() => setDrawerCSM(row.csm)}
                      >
                        <td className="flex items-center gap-2 px-5 py-2.5 font-medium text-card-foreground">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                            {i + 1}
                          </span>
                          <span className="max-w-[200px] truncate">
                            {row.csm}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-card-foreground">
                          {row.total}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          <span
                            className={
                              row.stuck > 0
                                ? "font-medium text-red-600"
                                : "text-muted-foreground"
                            }
                          >
                            {row.stuck}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-card-foreground">
                          {row.notStarted}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          <span
                            className={
                              row.inactive14 > 0
                                ? "font-medium text-orange-600"
                                : "text-muted-foreground"
                            }
                          >
                            {row.inactive14}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          <span
                            className={
                              row.unassigned > 0
                                ? "font-medium text-amber-600"
                                : "text-muted-foreground"
                            }
                          >
                            {row.unassigned}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums font-bold text-card-foreground">
                          {row.riskScore.toFixed(1)}
                        </td>
                        <td className="px-5 py-2.5 text-center">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${risk.bg} ${risk.text}`}
                          >
                            {risk.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Aging Buckets Summary ── */}
        <section className="mb-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Aging Buckets (by Inactive Days)
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <AgingCard label="0 - 2 days" count={agingBuckets.d0_2} color="#10b981" />
            <AgingCard label="3 - 6 days" count={agingBuckets.d3_6} color="#f59e0b" />
            <AgingCard label="7 - 13 days" count={agingBuckets.d7_13} color="#f97316" />
            <AgingCard label="14+ days" count={agingBuckets.d14plus} color="#ef4444" />
          </div>
        </section>

        {/* ── Critical Action Board ── */}
        <CollapsibleSection
          title="Critical Action Board"
          icon={Flame}
          defaultOpen={true}
          badge={
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-600">
              {criticalTasks.length}
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">
                    Task Name
                  </th>
                  <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">
                    CSM
                  </th>
                  <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">
                    Inactive Days
                  </th>
                  <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">
                    List / CSM
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">
                    Risk Weight
                  </th>
                  <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">
                    Trigger Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {criticalTasks.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-5 py-8 text-center text-muted-foreground"
                    >
                      No critical tasks found -- looking good!
                    </td>
                  </tr>
                ) : (
                  criticalTasks.slice(0, 50).map(({ task, weight }) => {
                    const days = inactiveDays(task);
                    const reasons = getTriggerReasons(task);
                    return (
                      <tr
                        key={task.id}
                        className="border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <td className="max-w-[200px] truncate px-5 py-2.5 font-medium text-card-foreground">
                          {task.url ? (
                            <a
                              href={task.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              {task.name}
                            </a>
                          ) : (
                            task.name
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-card-foreground">
                          {getAssignee(task)}
                        </td>
                        <td className="px-5 py-2.5">
                          <StatusBadge status={task.status.status} />
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          <span
                            className={
                              days >= 14
                                ? "font-bold text-red-600"
                                : days >= 7
                                ? "font-semibold text-orange-600"
                                : "text-muted-foreground"
                            }
                          >
                            {days}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-muted-foreground">
                          {getListName(task)}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <span
                            className={`inline-flex min-w-[40px] items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                              weight >= 4
                                ? "bg-red-500/15 text-red-600"
                                : weight >= 2
                                ? "bg-orange-500/15 text-orange-600"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {weight.toFixed(1)}
                          </span>
                        </td>
                        <td className="px-5 py-2.5">
                          <TriggerBadges reasons={reasons} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>

        {/* ── CSM Drill-Down Panel ── */}
        <CollapsibleSection
          title="CSM Drill-Down Panel"
          icon={Shield}
          defaultOpen={false}
          badge={
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {csmMetrics.length} CSMs
            </span>
          }
        >
          <div className="flex flex-col gap-3 p-4">
            {csmMetrics.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No CSM data available
              </p>
            ) : (
              csmMetrics.map((csm) => (
                <CSMCard
                  key={csm.csm}
                  data={csm}
                  onSelect={setDrawerCSM}
                />
              ))
            )}
          </div>
        </CollapsibleSection>

        {/* ── interactive tasks table ── */}
        <section className="rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
              <Users className="h-4 w-4 text-muted-foreground" />
              Tasks{" "}
              <span className="font-normal text-muted-foreground">
                ({filtered.length.toLocaleString()})
              </span>
            </h3>
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

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">
                    Task Name
                  </th>
                  <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">
                    Assignee
                  </th>
                  {customFieldNames.map((name) => (
                    <th
                      key={name}
                      className="px-5 py-2.5 text-left font-medium text-muted-foreground"
                    >
                      {name}
                    </th>
                  ))}
                  <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">
                    Last Updated
                  </th>
                  <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">
                    List / CSM
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">
                    Inactive Days
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagedTasks.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7 + customFieldNames.length}
                      className="px-5 py-12 text-center text-muted-foreground"
                    >
                      No tasks match the current filters
                    </td>
                  </tr>
                ) : (
                  pagedTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task as ClickUpTask}
                      statuses={availableStatuses}
                      assignees={availableAssignees}
                      customFieldNames={customFieldNames}
                      onUpdate={handleTaskUpdate}
                      updating={updating}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* footer */}
        <footer className="mt-6 pb-8 text-center text-xs text-muted-foreground">
          Showing {filtered.length.toLocaleString()} of{" "}
          {tasks.length.toLocaleString()} tasks
          {kpis.total > 0 && (
            <span>
              {" \u00B7 "}
              {kpis.completionRate}% completion rate
            </span>
          )}
          {activeFilterCount > 0 && (
            <span>
              {" \u00B7 "}
              {activeFilterCount} filter
              {activeFilterCount > 1 ? "s" : ""} active
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
