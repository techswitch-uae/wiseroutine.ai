import { localDateOf, zoneOffsetMs } from "@wiseroutine/scheduler";
import { api } from "./api";
import {
  assertSessionScope,
  captureSessionScope,
  invalidateServerState,
  type SessionScope,
} from "./session-lifecycle";
import { reloadTodos } from "./todos";

export const dateIn = (at: number, zone: string): string => {
  const d = localDateOf(at, zone);
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
};
export const addLocalDays = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** Explicitly reject nonexistent wall-clock times; offer both fall-back
 * occurrences rather than silently changing a user's appointment. */
export function wallTimes(date: string, time: string, zone: string): number[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    return [];
  const naive = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(naive)) return [];
  const offsets = new Set(
    [-86400000, 0, 86400000].map((delta) => zoneOffsetMs(naive + delta, zone)),
  );
  return [...offsets]
    .map((offset) => naive - offset)
    .filter(
      (at) =>
        dateIn(at, zone) === date &&
        new Intl.DateTimeFormat("en-GB", {
          timeZone: zone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(at) === time,
    )
    .sort((a, b) => a - b);
}
export function pickedTime(
  date: string,
  time: string,
  zone: string,
  now: number,
  occurrence = 0,
): number {
  const times = wallTimes(date, time, zone);
  const at = times.length === 1 ? times[0] : times[occurrence];
  if (at === undefined)
    throw new Error("That local time does not exist. Choose another time.");
  if (at < now || at > now + 366 * 86400000)
    throw new Error("Choose a future time within a year.");
  return at;
}
export function linksIn(text: string): string[] {
  return [
    ...new Set(
      (text.match(/https?:\/\/[^\s<>"]+/gi) ?? []).map((raw) => {
        let value = raw.replace(/[.,;!?]+$/, "");
        while (
          value.endsWith(")") &&
          (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)
        )
          value = value.slice(0, -1);
        return value;
      }),
    ),
  ].filter((value) => {
    try {
      const url = new URL(value);
      return !url.username && !url.password;
    } catch {
      return false;
    }
  });
}
export function captureError(
  error: unknown,
  fallback = "Couldn't save this change",
): string {
  const detail =
    error && typeof error === "object" && "detail" in error
      ? error.detail
      : undefined;
  return typeof detail === "string" && detail
    ? detail
    : error instanceof Error && error.message
      ? error.message
      : fallback;
}
export function refreshCaptured(): void {
  // The shell's operational controller also refreshes the visible calendar.
  invalidateServerState();
  void reloadTodos();
  globalThis.dispatchEvent(new Event("wr:inbox-changed"));
}

export async function downloadTodoFile(
  todoId: string,
  file: { id: string; name: string },
  scope: SessionScope = captureSessionScope(),
): Promise<void> {
  assertSessionScope(scope);
  const blob = await api.todoFile(todoId, file.id, scope);
  if ("__TAURI_INTERNALS__" in globalThis) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 4096)
      binary += String.fromCharCode(...bytes.subarray(i, i + 4096));
    const { invoke } = await import("@tauri-apps/api/core");
    assertSessionScope(scope);
    await invoke("save_attachment", { name: file.name, encoded: btoa(binary) });
    return;
  }
  assertSessionScope(scope);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
