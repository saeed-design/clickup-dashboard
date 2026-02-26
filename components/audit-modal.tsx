"use client";

import { useEffect, useState } from "react";
import { X, RotateCcw, History, Loader2 } from "lucide-react";
import type { AuditRecord } from "@/lib/types";

interface AuditModalProps {
  taskId: string;
  taskName: string;
  onClose: () => void;
  onRevert: (record: AuditRecord) => void;
}

export function AuditModal({
  taskId,
  taskName,
  onClose,
  onRevert,
}: AuditModalProps) {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/audit?taskId=${encodeURIComponent(taskId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed");
        setRecords(data.records ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [taskId]);

  function fieldLabel(field: string) {
    if (field === "status") return "Status";
    if (field === "assignee") return "Assignee";
    if (field.startsWith("custom_field:")) return field.replace("custom_field:", "CF: ");
    return field;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-x-4 top-[10%] z-50 mx-auto max-w-lg rounded-xl border border-border bg-card shadow-2xl sm:inset-x-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-semibold text-card-foreground">
                Change History
              </h2>
              <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                {taskName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <p className="py-4 text-center text-sm text-destructive">{error}</p>
          )}

          {!loading && !error && records.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No changes recorded yet
            </p>
          )}

          {!loading &&
            records.map((rec) => (
              <div
                key={rec.id}
                className="mb-3 rounded-lg border border-border bg-muted/30 p-3 last:mb-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {fieldLabel(rec.fieldName)}
                      </span>
                      {rec.isSubtask && (
                        <span className="text-[10px] text-muted-foreground">
                          (subtask)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground line-through">
                        {rec.fromValue || "(empty)"}
                      </span>
                      <span className="text-muted-foreground">{"-->"}</span>
                      <span className="font-medium text-card-foreground">
                        {rec.toValue || "(empty)"}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(rec.timestamp).toLocaleString()} by {rec.actor}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRevert(rec)}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    title="Revert this change"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Revert
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
