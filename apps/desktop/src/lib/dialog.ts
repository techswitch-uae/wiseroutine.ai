import { type RefObject, useEffect, useRef } from "react";
export function useDialogFocus(
  root: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement;
    const node = root.current;
    if (!node) return;
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]',
        ),
      ).filter(
        (el) =>
          !el.hidden &&
          !el.matches(":disabled") &&
          !el.closest("[hidden],[inert]") &&
          el.getAttribute("aria-hidden") !== "true",
      );
    (
      node.querySelector<HTMLElement>("input,textarea") ??
      focusable()[0] ??
      node
    ).focus();
    const top = () =>
      Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) === node;
    const key = (event: KeyboardEvent) => {
      if (!top() || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable(),
        first = items[0],
        last = items.at(-1);
      if (!first) {
        event.preventDefault();
        node.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === node)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !node.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    const focus = (event: FocusEvent) => {
      if (top() && event.target instanceof Node && !node.contains(event.target))
        (focusable()[0] ?? node).focus();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("focusin", focus);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("focusin", focus);
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [root]);
}
