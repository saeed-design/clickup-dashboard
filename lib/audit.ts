/* ── Audit log storage ──
   TODO: Migrate to Vercel KV for persistence across deploys.
   Currently uses an in-memory Map (lost on cold start).
*/

import type { AuditRecord } from "./types";

const store = new Map<string, AuditRecord[]>();

let counter = 0;
function uid(): string {
  return `audit_${Date.now()}_${++counter}`;
}

export function writeAudit(record: Omit<AuditRecord, "id">): AuditRecord {
  const entry: AuditRecord = { ...record, id: uid() };
  const list = store.get(record.taskId) ?? [];
  list.push(entry);
  store.set(record.taskId, list);
  return entry;
}

export function readAudit(taskId: string): AuditRecord[] {
  return (store.get(taskId) ?? []).sort((a, b) => b.timestamp - a.timestamp);
}

export function allAudit(): AuditRecord[] {
  const all: AuditRecord[] = [];
  for (const records of store.values()) all.push(...records);
  return all.sort((a, b) => b.timestamp - a.timestamp);
}
