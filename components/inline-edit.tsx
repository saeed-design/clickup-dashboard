"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";

interface InlineEditProps {
  value: string;
  onCommit: (value: string) => void;
  type?: "text" | "number";
  disabled?: boolean;
}

export function InlineEdit({
  value,
  onCommit,
  type = "text",
  disabled,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [editing, value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => !disabled && setEditing(true)}
        disabled={disabled}
        className="group flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-card-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate max-w-[120px]">{value || "--"}</span>
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
        className="h-6 w-24 rounded-md border border-border bg-card px-1.5 text-xs text-card-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <button
        type="button"
        onClick={commit}
        className="rounded-md p-0.5 text-emerald-600 hover:bg-emerald-500/10"
      >
        <Check className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={cancel}
        className="rounded-md p-0.5 text-muted-foreground hover:bg-muted"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
