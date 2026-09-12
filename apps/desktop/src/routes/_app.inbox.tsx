import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "../lib/account";
import { api, type InboxItem } from "../lib/api";
import { Bucket } from "../modules/dashboard";
import { TodoDetails } from "../modules/todo-details";
import "../modules/capture.css";

function Inbox() {
  const account = useAccount();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(
    async (next?: string) => {
      const order = ++sequence.current;
      setLoading(true);
      try {
        const result = await api.inbox(next, done, query);
        if (order !== sequence.current) return;
        setItems((prev) =>
          next
            ? [
                ...prev,
                ...result.items.filter(
                  (item) => !prev.some((p) => p.id === item.id),
                ),
              ]
            : result.items,
        );
        setCursor(result.nextCursor);
        setError("");
      } catch (cause) {
        if (order === sequence.current)
          setError(
            cause instanceof Error ? cause.message : "Couldn't load the inbox",
          );
      } finally {
        if (order === sequence.current) setLoading(false);
      }
    },
    [done, query],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 150);
    const refresh = () => void load();
    globalThis.addEventListener("wr:inbox-changed", refresh);
    globalThis.addEventListener("focus", refresh);
    return () => {
      sequence.current++;
      clearTimeout(timer);
      globalThis.removeEventListener("wr:inbox-changed", refresh);
      globalThis.removeEventListener("focus", refresh);
    };
  }, [load]);
  return (
    <section className="wr-inbox">
      <h1>Inbox</h1>
      <p>
        Tasks, reading and files—keep them here until you are ready to give them
        a time.
      </p>
      <div className="wr-capture-actions">
        <button
          type="button"
          className="wr-palette-pill wr-palette-pill-on"
          onClick={() => globalThis.dispatchEvent(new Event("wr:quick-add"))}
        >
          Add something · ⌘K
        </button>
        <label>
          <input
            type="checkbox"
            checked={done}
            onChange={(e) => setDone(e.target.checked)}
          />{" "}
          Completed and dropped only
        </label>
      </div>
      <label className="wr-capture-label">
        Search inbox
        <input
          type="search"
          maxLength={200}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : null}
      <ul className="wr-inbox-list">
        {items.map((item) => (
          <li className="wr-inbox-item" key={item.id}>
            <button
              type="button"
              className="wr-inbox-title"
              onClick={() => setSelected(item.id)}
            >
              {item.title}
              <small>
                {item.status === "open"
                  ? "No time yet"
                  : item.status === "slotted"
                    ? `Planned${item.startsAt ? ` · ${new Intl.DateTimeFormat(undefined, { timeZone: account?.timeZone, dateStyle: "medium", timeStyle: "short" }).format(item.startsAt)}` : ""}`
                    : item.status}{" "}
                · {item.minutes ?? 15} min
              </small>
            </button>
            <button
              type="button"
              className="wr-palette-pill"
              onClick={() => setSelected(item.id)}
            >
              Open / plan
            </button>
          </li>
        ))}
      </ul>
      {loading ? (
        <p role="status">Loading…</p>
      ) : !items.length && !error ? (
        <p>
          {query
            ? "No matching items."
            : done
              ? "No finished items yet."
              : "Your inbox is clear. Capture text, links or files with Quick Add."}
        </p>
      ) : null}
      {cursor ? (
        <button
          type="button"
          className="wr-palette-pill"
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          Load more
        </button>
      ) : null}
      {!done ? <Bucket standalone query={query} /> : null}
      {selected && account?.timeZone ? (
        <TodoDetails
          key={selected}
          id={selected}
          timeZone={account.timeZone}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
}
export const Route = createFileRoute("/_app/inbox")({
  component: Inbox,
  staticData: { fullWidth: true },
});
