"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import type {
  ClickUpTask,
  ClickUpStatus,
  ClickUpAssignee,
  ClickUpCustomField,
  AuditRecord,
} from "@/lib/types";
import { InlineSelect } from "./inline-select";
import { InlineEdit } from "./inline-edit";
import { InlineCheckbox } from "./inline-checkbox";
import { AuditModal } from "./audit-modal";

/* ── helpers ── */

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

function getStatusColor(status: string) {
  return STATUS_COLOR_MAP[status.toLowerCase()] || "#64748b";
}

const NOW = Date.now();
const ONE_DAY = 86400000;

function inactiveDays(task: ClickUpTask): number {
  const updated = Number(task.date_updated);
  if (!updated || isNaN(updated)) return 0;
  return Math.floor((NOW - updated) / ONE_DAY);
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

function getAssignee(task: ClickUpTask) {
  return task.assignees?.[0]?.username || "Unassigned";
}

function getListName(task: ClickUpTask) {
  return task.list?.name || task.list?.id || "Unknown";
}

/* ── Custom field cell ── */

function CustomFieldCell({
  cf,
  onUpdate,
  updating,
}: {
  cf: ClickUpCustomField;
  onUpdate: (fieldId: string, value: unknown) => void;
  updating: boolean;
}) {
  const t = cf.type;

  if (t === "drop_down" || t === "labels") {
    const opts =
      cf.type_config?.options?.map((o) => ({
        value: o.id ?? o.name,
        label: o.name ?? o.label ?? o.id,
        color: o.color,
      })) ?? [];

    const currentIdx = typeof cf.value === "number" ? cf.value : null;
    const currentOpt =
      currentIdx != null ? cf.type_config?.options?.[currentIdx] : null;
    const currentVal = currentOpt?.id ?? currentOpt?.name ?? "";

    return (
      <InlineSelect
        value={currentVal}
        options={opts}
        onCommit={(v) => onUpdate(cf.id, v)}
        disabled={updating}
      />
    );
  }

  if (t === "checkbox") {
    const checked = cf.value === true || cf.value === "true";
    return (
      <InlineCheckbox
        checked={checked}
        onCommit={(v) => onUpdate(cf.id, v)}
        disabled={updating}
      />
    );
  }

  if (t === "number") {
    return (
      <InlineEdit
        value={cf.value != null ? String(cf.value) : ""}
        type="number"
        onCommit={(v) => onUpdate(cf.id, Number(v))}
        disabled={updating}
      />
    );
  }

  // text / short_text / other
  return (
    <InlineEdit
      value={cf.value != null ? String(cf.value) : ""}
      onCommit={(v) => onUpdate(cf.id, v)}
      disabled={updating}
    />
  );
}

/* ── Single row renderer ── */

function SingleRow({
  task,
  statuses,
  assignees,
  customFieldNames,
  onUpdate,
  updating,
  indent,
}: {
  task: ClickUpTask;
  statuses: ClickUpStatus[];
  assignees: ClickUpAssignee[];
  customFieldNames: string[];
  onUpdate: (taskId: string, field: string, value: unknown) => void;
  updating: boolean;
  indent: boolean;
}) {
  const [auditOpen, setAuditOpen] = useState(false);
  const days = inactiveDays(task);

  const statusOpts = statuses.map((s) => ({
    value: s.status,
    label: s.status,
    color: s.color,
  }));

  const assigneeOpts = [
    { value: "__unassigned__", label: "Unassigned" },
    ...assignees.map((a) => ({
      value: String(a.id),
      label: a.username,
    })),
  ];

  const currentAssigneeValue =
    task.assignees?.[0] ? String(task.assignees[0].id) : "__unassigned__";

  function handleRevert(rec: AuditRecord) {
    onUpdate(task.id, rec.fieldName, rec.fromValue);
    setAuditOpen(false);
  }

  return (
    <>
      <tr className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
        {/* Name */}
        <td
          className="max-w-xs truncate px-5 py-2.5 font-medium text-card-foreground"
          style={indent ? { paddingLeft: "2.5rem" } : undefined}
        >
          {task.url ? (
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {indent && (
                <span className="mr-1 text-muted-foreground">{"--"}</span>
              )}
              {task.name}
            </a>
          ) : (
            <>
              {indent && (
                <span className="mr-1 text-muted-foreground">{"--"}</span>
              )}
              {task.name}
            </>
          )}
        </td>

        {/* Status */}
        <td className="px-5 py-2.5">
          <InlineSelect
            value={task.status.status}
            options={statusOpts}
            onCommit={(v) => onUpdate(task.id, "status", v)}
            disabled={updating}
            renderValue={(val) => (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: `${getStatusColor(val)}18`,
                  color: getStatusColor(val),
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: getStatusColor(val) }}
                />
                {val}
              </span>
            )}
          />
        </td>

        {/* Assignee */}
        <td className="px-5 py-2.5">
          <InlineSelect
            value={currentAssigneeValue}
            options={assigneeOpts}
            onCommit={(v) => {
              if (v === "__unassigned__") {
                onUpdate(task.id, "assignee", []);
              } else {
                onUpdate(task.id, "assignee", [Number(v)]);
              }
            }}
            disabled={updating}
          />
        </td>

        {/* Custom fields */}
        {customFieldNames.map((cfName) => {
          const cf = task.custom_fields?.find((f) => f.name === cfName);
          if (!cf) return <td key={cfName} className="px-5 py-2.5 text-xs text-muted-foreground">--</td>;
          return (
            <td key={cfName} className="px-5 py-2.5">
              <CustomFieldCell
                cf={cf}
                onUpdate={(fieldId, value) =>
                  onUpdate(task.id, `custom_field:${fieldId}`, value)
                }
                updating={updating}
              />
            </td>
          );
        })}

        {/* Last Updated */}
        <td className="px-5 py-2.5 text-muted-foreground">
          <span className="tabular-nums text-xs">
            {formatRelative(task.date_updated)}
          </span>
          <span className="ml-1.5 text-[10px] text-muted-foreground/60">
            {formatDate(task.date_updated)}
          </span>
        </td>

        {/* List */}
        <td className="px-5 py-2.5 text-xs text-muted-foreground">
          {getListName(task)}
        </td>

        {/* Inactive Days */}
        <td className="px-5 py-2.5 text-right tabular-nums">
          <span
            className={`inline-flex min-w-[32px] items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium ${
              days >= 14
                ? "bg-red-500/15 font-bold text-red-600"
                : days >= 7
                ? "bg-orange-500/15 font-semibold text-orange-600"
                : "text-muted-foreground"
            }`}
          >
            {days}
          </span>
        </td>

        {/* Actions */}
        <td className="px-3 py-2.5">
          <button
            type="button"
            onClick={() => setAuditOpen(true)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-card-foreground"
            title="View history"
          >
            <History className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>

      {auditOpen && (
        <tr>
          <td colSpan={99}>
            <AuditModal
              taskId={task.id}
              taskName={task.name}
              onClose={() => setAuditOpen(false)}
              onRevert={handleRevert}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Expandable task row (parent + subtasks) ── */

interface TaskRowProps {
  task: ClickUpTask;
  statuses: ClickUpStatus[];
  assignees: ClickUpAssignee[];
  customFieldNames: string[];
  onUpdate: (taskId: string, field: string, value: unknown) => void;
  updating: boolean;
}

export function TaskRow({
  task,
  statuses,
  assignees,
  customFieldNames,
  onUpdate,
  updating,
}: TaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const subtasks = task.subtasks ?? [];
  const hasSubtasks = subtasks.length > 0;

  return (
    <>
      {/* Parent row with expand toggle in name cell */}
      <tr className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
        {/* Name with expand toggle */}
        <td className="max-w-xs px-5 py-2.5 font-medium text-card-foreground">
          <div className="flex items-center gap-1.5">
            {hasSubtasks && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="rounded-md p-0.5 text-muted-foreground hover:bg-muted"
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            {!hasSubtasks && <span className="w-[18px]" />}
            <span className="truncate">
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
            </span>
            {hasSubtasks && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {subtasks.length}
              </span>
            )}
          </div>
        </td>

        {/* Status */}
        <td className="px-5 py-2.5">
          <InlineSelect
            value={task.status.status}
            options={statuses.map((s) => ({
              value: s.status,
              label: s.status,
              color: s.color,
            }))}
            onCommit={(v) => onUpdate(task.id, "status", v)}
            disabled={updating}
            renderValue={(val) => (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: `${getStatusColor(val)}18`,
                  color: getStatusColor(val),
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: getStatusColor(val) }}
                />
                {val}
              </span>
            )}
          />
        </td>

        {/* Assignee */}
        <td className="px-5 py-2.5">
          <InlineSelect
            value={
              task.assignees?.[0]
                ? String(task.assignees[0].id)
                : "__unassigned__"
            }
            options={[
              { value: "__unassigned__", label: "Unassigned" },
              ...assignees.map((a) => ({
                value: String(a.id),
                label: a.username,
              })),
            ]}
            onCommit={(v) => {
              if (v === "__unassigned__") {
                onUpdate(task.id, "assignee", []);
              } else {
                onUpdate(task.id, "assignee", [Number(v)]);
              }
            }}
            disabled={updating}
          />
        </td>

        {/* Custom fields */}
        {customFieldNames.map((cfName) => {
          const cf = task.custom_fields?.find((f) => f.name === cfName);
          if (!cf)
            return (
              <td
                key={cfName}
                className="px-5 py-2.5 text-xs text-muted-foreground"
              >
                --
              </td>
            );
          return (
            <td key={cfName} className="px-5 py-2.5">
              <CustomFieldCell
                cf={cf}
                onUpdate={(fieldId, value) =>
                  onUpdate(task.id, `custom_field:${fieldId}`, value)
                }
                updating={updating}
              />
            </td>
          );
        })}

        {/* Last Updated */}
        <td className="px-5 py-2.5 text-muted-foreground">
          <span className="tabular-nums text-xs">
            {formatRelative(task.date_updated)}
          </span>
          <span className="ml-1.5 text-[10px] text-muted-foreground/60">
            {formatDate(task.date_updated)}
          </span>
        </td>

        {/* List */}
        <td className="px-5 py-2.5 text-xs text-muted-foreground">
          {getListName(task)}
        </td>

        {/* Inactive Days */}
        <td className="px-5 py-2.5 text-right tabular-nums">
          {(() => {
            const days = inactiveDays(task);
            return (
              <span
                className={`inline-flex min-w-[32px] items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  days >= 14
                    ? "bg-red-500/15 font-bold text-red-600"
                    : days >= 7
                    ? "bg-orange-500/15 font-semibold text-orange-600"
                    : "text-muted-foreground"
                }`}
              >
                {days}
              </span>
            );
          })()}
        </td>

        {/* History button */}
        <td className="px-3 py-2.5">
          <HistoryButton taskId={task.id} taskName={task.name} onUpdate={onUpdate} />
        </td>
      </tr>

      {/* Subtask rows */}
      {expanded &&
        subtasks.map((sub) => (
          <SingleRow
            key={sub.id}
            task={sub}
            statuses={statuses}
            assignees={assignees}
            customFieldNames={customFieldNames}
            onUpdate={onUpdate}
            updating={updating}
            indent
          />
        ))}
    </>
  );
}

/* ── History button (extracted to avoid modal render in each row's td) ── */

function HistoryButton({
  taskId,
  taskName,
  onUpdate,
}: {
  taskId: string;
  taskName: string;
  onUpdate: (taskId: string, field: string, value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);

  function handleRevert(rec: AuditRecord) {
    onUpdate(taskId, rec.fieldName, rec.fromValue);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-card-foreground"
        title="View history"
      >
        <History className="h-3.5 w-3.5" />
      </button>
      {open && (
        <AuditModal
          taskId={taskId}
          taskName={taskName}
          onClose={() => setOpen(false)}
          onRevert={handleRevert}
        />
      )}
    </>
  );
}
