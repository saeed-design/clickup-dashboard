"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

interface Option {
  value: string;
  label: string;
  color?: string;
}

interface InlineSelectProps {
  value: string;
  options: Option[];
  onCommit: (value: string) => void;
  disabled?: boolean;
  renderValue?: (value: string, option?: Option) => React.ReactNode;
}

export function InlineSelect({
  value,
  options,
  onCommit,
  disabled,
  renderValue,
}: InlineSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (open) {
      console.log("[v0] InlineSelect opened with", options.length, "options");
    }
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        {renderValue ? renderValue(value, current) : (current?.label ?? value)}
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-44 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                if (opt.value !== value) onCommit(opt.value);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
                opt.value === value
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-popover-foreground"
              }`}
            >
              {opt.color && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: opt.color }}
                />
              )}
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
