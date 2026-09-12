import { useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../lib/dialog";
export function CaptureModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useDialogFocus(root, onClose);
  return createPortal(
    <div className="wr-overlay wr-capture-overlay">
      <button
        className="wr-overlay-back"
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
      />
      <div
        ref={root}
        className="wr-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="wr-sheet-head">
          <h2 className="wr-sheet-title" title={title}>
            {title}
          </h2>
          <button
            type="button"
            className="wr-palette-pill"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="wr-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
