export type CaptureSubject =
  | { kind: "text"; title: string; minutes: number }
  | { kind: "activity" | "todo"; id: string; title: string; minutes: number };
export interface CaptureDraft {
  subject?: CaptureSubject;
  /** A lost response must retry the original appointment, not the next gap. */
  attempt?: { startsAt?: number; minutes: number };
  id: string;
  text: string;
  notes: string;
  files: { id: string; file: File }[];
}
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function isCaptureDraft(value: unknown): value is CaptureDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<CaptureDraft>,
    s = d.subject,
    a = d.attempt;
  return (
    typeof d.id === "string" &&
    uuid.test(d.id) &&
    typeof d.text === "string" &&
    typeof d.notes === "string" &&
    Array.isArray(d.files) &&
    d.files.length <= 10 &&
    d.files.every(
      (f) =>
        f &&
        typeof f.id === "string" &&
        uuid.test(f.id) &&
        f.file instanceof File &&
        f.file.size <= 5 * 1024 * 1024,
    ) &&
    d.files.reduce((n, f) => n + f.file.size, 0) <= 20 * 1024 * 1024 &&
    (s === undefined ||
      Boolean(
        s &&
          typeof s.title === "string" &&
          Number.isFinite(s.minutes) &&
          (s.kind === "text" ||
            ((s.kind === "activity" || s.kind === "todo") &&
              typeof s.id === "string")),
      )) &&
    (a === undefined ||
      Boolean(
        a &&
          Number.isFinite(a.minutes) &&
          (a.startsAt === undefined || Number.isSafeInteger(a.startsAt)),
      ))
  );
}
const DATABASE = "wiseroutine-capture-drafts";
const DEADLINE = 2000;
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error("Draft storage timed out")),
      DEADLINE,
    );
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onerror = () => fail(request.error);
    request.onblocked = () =>
      fail(new Error("Close other app windows to save this draft."));
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
function transact<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode);
    const request = run(tx.objectStore("drafts"));
    const timer = setTimeout(() => {
      try {
        tx.abort();
      } catch {
        /* A completed native transaction can still deliver its event late. */
      }
      reject(new Error("Draft storage timed out"));
    }, DEADLINE);
    tx.oncomplete = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    tx.onabort = tx.onerror = () => {
      clearTimeout(timer);
      reject(tx.error ?? new Error("Draft could not be saved"));
    };
  });
}
export async function readCaptureDraft(
  account: string | null,
): Promise<CaptureDraft | null> {
  if (!account) return null;
  const db = await database();
  try {
    const value = await transact<unknown>(db, "readonly", (store) =>
      store.get(account),
    );
    if (value === undefined) return null;
    if (!isCaptureDraft(value))
      throw new Error(
        "The saved draft cannot be read safely. It has not been overwritten.",
      );
    return value;
  } finally {
    db.close();
  }
}
let writes: Promise<void> = Promise.resolve();
/** Serialize saves and deletion so a late autosave cannot resurrect a saved
 * capture. Account identity is captured on open, never looked up on completion. */
export function saveCaptureDraft(
  account: string | null,
  draft: CaptureDraft | null,
): Promise<void> {
  if (!account) return Promise.resolve();
  const write = writes
    .catch(() => undefined)
    .then(async () => {
      const db = await database();
      try {
        if (draft)
          await transact(db, "readwrite", (store) => store.put(draft, account));
        else await transact(db, "readwrite", (store) => store.delete(account));
      } finally {
        db.close();
      }
    });
  writes = write;
  return write;
}
