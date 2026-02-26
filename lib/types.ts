/* ── Shared types for ClickUp interactive dashboard ── */

export interface ClickUpAssignee {
  id: number;
  username: string;
  profilePicture?: string;
}

export interface ClickUpStatus {
  status: string;
  color?: string;
  orderindex?: number;
}

export interface ClickUpCustomFieldOption {
  id: string;
  name: string;
  label?: string;
  color?: string;
  orderindex?: number;
}

export interface ClickUpCustomField {
  id: string;
  name: string;
  type: string; // "drop_down" | "labels" | "checkbox" | "short_text" | "number" | "text" | ...
  value?: unknown;
  type_config?: {
    options?: ClickUpCustomFieldOption[];
  };
}

export interface ClickUpTask {
  id: string;
  name: string;
  status: { status: string; color?: string };
  assignees: ClickUpAssignee[];
  list: { id: string; name?: string };
  due_date: string | null;
  date_created: string;
  date_updated: string;
  priority?: { priority: string; color: string } | null;
  url?: string;
  parent?: string | null;
  custom_fields?: ClickUpCustomField[];
  subtasks?: ClickUpTask[];
}

export interface AuditRecord {
  id: string;
  taskId: string;
  taskName: string;
  isSubtask: boolean;
  fieldName: string;
  fromValue: string;
  toValue: string;
  timestamp: number;
  actor: string;
}

export interface TaskUpdatePayload {
  taskId: string;
  field: string; // "status" | "assignee" | `custom_field:${fieldId}`
  value: unknown;
}

export interface ClickUpPriority {
  priority: string;
  color: string;
}

export interface EnhancedApiResponse {
  ok: boolean;
  total: number;
  tasks: ClickUpTask[];
  byStatus: Record<string, number>;
  byAssignee: Record<string, number>;
  availableStatuses: ClickUpStatus[];
  availableAssignees: ClickUpAssignee[];
  availablePriorities?: ClickUpPriority[];
  error?: string;
}
