import { NextRequest, NextResponse } from "next/server";
import { fetchTask, updateTask, updateCustomField } from "@/lib/clickup";
import { writeAudit } from "@/lib/audit";
import { updateCacheTask } from "@/lib/task-cache";
import type { TaskUpdatePayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body: TaskUpdatePayload = await req.json();
    const { taskId, field, value } = body;

    if (!taskId || !field) {
      return NextResponse.json(
        { ok: false, error: "taskId and field are required" },
        { status: 400 }
      );
    }

    // 1) Fetch current task for "before" snapshot
    const before = await fetchTask(taskId);
    const isSubtask = !!before.parent;

    let fromValue = "";
    let toValue = String(value ?? "");

    if (field === "status") {
      fromValue = before.status?.status ?? "";
      toValue = String(value);
      await updateTask(taskId, { status: String(value) });
    } else if (field === "assignee") {
      fromValue =
        before.assignees?.map((a) => a.username).join(", ") || "Unassigned";
      // value should be assignee user id (number) or array of ids
      const ids = Array.isArray(value) ? value : [value];
      toValue = ids.join(", ");
      await updateTask(taskId, {
        assignees: { add: ids, rem: before.assignees?.map((a) => a.id) ?? [] },
      });
    } else if (field === "priority") {
      fromValue = before.priority?.priority ?? "None";
      toValue = value ? String(value) : "None";
      // ClickUp API expects priority as integer: 1=urgent, 2=high, 3=normal, 4=low
      // or null to unset
      const priorityMap: Record<string, number | null> = {
        urgent: 1,
        high: 2,
        normal: 3,
        low: 4,
        none: null,
      };
      const priorityValue = priorityMap[String(value).toLowerCase()] ?? null;
      await updateTask(taskId, { priority: priorityValue });
    } else if (field.startsWith("custom_field:")) {
      const fieldId = field.replace("custom_field:", "");
      const existing = before.custom_fields?.find((cf) => cf.id === fieldId);
      fromValue = existing?.value != null ? String(existing.value) : "";
      toValue = String(value ?? "");
      await updateCustomField(taskId, fieldId, value);
    } else {
      return NextResponse.json(
        { ok: false, error: `Unsupported field: ${field}` },
        { status: 400 }
      );
    }

    // 2) Write audit record
    writeAudit({
      taskId,
      taskName: before.name,
      isSubtask,
      fieldName: field,
      fromValue,
      toValue,
      timestamp: Date.now(),
      actor: "dashboard",
    });

    // 3) Fetch updated task and patch the cache
    const updated = await fetchTask(taskId);
    await updateCacheTask(updated).catch(() => {});

    return NextResponse.json({ ok: true, task: updated });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
