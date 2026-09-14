import { IconButton } from "@wiseroutine/design";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../lib/dialog";
export function CaptureModal({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  /** The line under the title, as the kit's `Modal` draws it. */
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Actions, ruled off at the foot of the sheet - see `.wr-sheet-foot`. */
  footer?: React.ReactNode;
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
          <div style={{ minWidth: 0 }}>
            <h2 className="wr-sheet-title" title={title}>
              {title}
            </h2>
            {subtitle ? <p className="wr-sheet-sub">{subtitle}</p> : null}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </IconButton>
        </header>
        <div
          className={
            footer ? "wr-sheet-body wr-sheet-body-above-foot" : "wr-sheet-body"
          }
        >
          {children}
        </div>
        {footer ? <div className="wr-sheet-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
