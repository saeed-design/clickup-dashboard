"use client";

interface InlineCheckboxProps {
  checked: boolean;
  onCommit: (checked: boolean) => void;
  disabled?: boolean;
}

export function InlineCheckbox({
  checked,
  onCommit,
  disabled,
}: InlineCheckboxProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onCommit(!checked)}
      disabled={disabled}
      className="flex h-5 w-5 items-center justify-center rounded-sm border border-border transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      style={
        checked
          ? { backgroundColor: "#3b82f6", borderColor: "#3b82f6" }
          : undefined
      }
    >
      {checked && (
        <svg
          viewBox="0 0 12 12"
          className="h-3 w-3 text-card"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M2 6l3 3 5-5" />
        </svg>
      )}
    </button>
  );
}
