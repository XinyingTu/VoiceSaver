import React, { useEffect, useRef, useState } from "react";
import { ShieldIcon } from "./Icons.jsx";

/**
 * Accessible confirmation dialog gating the ADA Voice Equity Shield ON.
 * - Focus moves into the dialog on open (the checkbox) and the caller returns
 *   focus to the toggle on close.
 * - Escape and overlay-click cancel. Focus is trapped within the dialog.
 * - The checkbox has a real <label>; "Confirm & Enable" is disabled until checked.
 * This is a self-attestation, NOT identity verification — no uploads or proof.
 */
export default function AdaConfirmModal({ onConfirm, onCancel }) {
  const [checked, setChecked] = useState(false);
  const dialogRef = useRef(null);
  const checkboxRef = useRef(null);

  useEffect(() => {
    checkboxRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        const nodes = dialogRef.current?.querySelectorAll(
          'button, input, [href], [tabindex]:not([tabindex="-1"])'
        );
        const list = Array.from(nodes || []).filter((el) => !el.disabled && el.offsetParent !== null);
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ada-modal-title"
        aria-describedby="ada-modal-desc"
        className="w-full max-w-md rounded-xl border border-access/60 bg-panel p-5 shadow-2xl"
      >
        <h2 id="ada-modal-title" className="mb-2 flex items-center gap-2 text-lg font-bold text-body">
          <ShieldIcon className="text-access" />
          Enable ADA Voice Equity Shield
        </h2>

        <p id="ada-modal-desc" className="text-[14px] text-muted">
          Enable this only if you (or the person you're representing) genuinely have a vocal,
          cognitive-processing, or hearing-related accessibility need. When enabled, if a dispatcher
          exhibits automated-blocking behavior, the AI proxy will truthfully disclose this accessibility
          context. When disabled (default), the proxy always answers identity questions plainly and never
          references any accessibility status.
        </p>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-edge bg-panel2 p-3">
          <input
            ref={checkboxRef}
            id="ada-confirm-checkbox"
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-access"
          />
          <label htmlFor="ada-confirm-checkbox" className="text-[14px] text-body">
            I confirm that I (or the person I am representing) genuinely have a relevant accessibility need.
          </label>
        </div>

        <p className="mt-2 text-[12px] text-muted">
          This is a self-attestation for audit purposes only — no identity check or documentation is required or requested.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!checked}
            onClick={onConfirm}
          >
            Confirm &amp; Enable
          </button>
        </div>
      </div>
    </div>
  );
}
