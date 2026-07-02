// Ori v2 — shared modal accessibility.
//
// Info modals and dialogs in v2 were pointer-only: dismissable by tapping the
// backdrop, with no Escape key and no focus management — a keyboard or screen-
// reader user could open one and get stranded behind it. This hook adds the two
// missing halves: Escape-to-close, and move-focus-in-on-open / restore-on-close.
//
// Usage: give the dialog element a ref and `tabIndex={-1}`, then
//   useModalA11y(open, onClose, dialogRef)
// (Pair with role="dialog" aria-modal="true" on that element.)

import { useEffect, useRef } from 'react';

export function useModalA11y(open, onClose, dialogRef) {
  // Keep the latest onClose without making it an effect dependency, so the
  // listeners attach once per open (not on every parent re-render).
  const cbRef = useRef(onClose);
  cbRef.current = onClose;
  const prevFocus = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    prevFocus.current = document.activeElement;
    // Move focus into the dialog — its first focusable child, else the container.
    const el = dialogRef?.current;
    if (el) {
      const focusable = el.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      try { (focusable || el).focus?.(); } catch { /* ignore */ }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); cbRef.current?.(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      try { prevFocus.current?.focus?.(); } catch { /* element may be gone */ }
    };
  }, [open, dialogRef]);
}
