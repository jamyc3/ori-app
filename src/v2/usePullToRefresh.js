// Ori v2 — pull-to-refresh, app-wide.
//
// One gesture handler mounted on the content slot. It resolves the *active*
// scroll container from the touch target at touch time (each screen owns its
// own scroller — .v2-day, .v2-journal, …, nested inside .v2-content), and only
// engages when that scroller is already at the very top. Pull a little →
// release does a soft re-sync (re-pull sources, re-read every surface). Pull
// further → release does a full reload. Bounded, passive where it can be, and
// it never fights a normal upward scroll.
//
// Why a custom gesture rather than the browser's: iOS WKWebView has no native
// pull-to-refresh inside a fixed app frame, and the user asked for the whole
// app to be drawable-down. The handler preventDefaults only while it actually
// owns the pull, so ordinary scrolling is untouched.

import { useEffect, useRef, useState } from 'react';

const SOFT_AT = 62;   // resisted px to arm a soft refresh
const HARD_AT = 124;  // resisted px to arm a full reload
const MAX_PULL = 150; // clamp so the content can't be dragged off-screen
const RESIST = 0.5;   // finger travel → visible travel

// Walk up from the touched node to the nearest real scroll container, stopping
// at the content slot. Falls back to the slot itself (short screens that don't
// scroll still pull from the top).
function findScroller(node, root) {
  let el = node;
  while (el && el.nodeType === 1 && el !== root.parentElement) {
    if (el === root) return root;
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
    el = el.parentElement;
  }
  return root;
}

// `enabledRef` (optional): a ref whose `.current === false` disarms the gesture.
// Pull-to-refresh belongs on the base tabs (re-sync data) — NOT on drill-down
// overlays (Ring detail, Part, Day…), where translating the whole screen on a
// downward drag reads as the page sliding around under your finger. The caller
// keeps the ref current; we read it at touch time so it's always live.
export function usePullToRefresh(rootRef, onSoftRefresh, enabledRef) {
  const [pull, setPullState] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const pullRef = useRef(0);
  const busyRef = useRef(false);
  const g = useRef({ active: false, pulling: false, startY: 0, scroller: null });

  const setPull = (v) => { pullRef.current = v; setPullState(v); };
  useEffect(() => { busyRef.current = busy; }, [busy]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === 'undefined') return undefined;

    const onStart = (e) => {
      if (busyRef.current || (enabledRef && enabledRef.current === false)) { g.current.active = false; return; }
      const t = e.touches && e.touches[0];
      if (!t) { g.current.active = false; return; }
      const scroller = findScroller(e.target, root);
      // Only arm when whatever scrolls here is already pinned to the top.
      if (!scroller || scroller.scrollTop > 0) { g.current.active = false; return; }
      g.current = { active: true, pulling: false, startY: t.clientY, scroller };
    };

    const onMove = (e) => {
      const s = g.current;
      if (!s.active || busyRef.current) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      const dy = t.clientY - s.startY;
      // Moving up, or the scroller left the top → hand the gesture back.
      if (dy <= 0 || (s.scroller && s.scroller.scrollTop > 0)) {
        if (s.pulling) { s.pulling = false; setDragging(false); setPull(0); }
        s.active = false;
        return;
      }
      if (!s.pulling) { s.pulling = true; setDragging(true); }
      // We own the pull now — stop the native rubber-band from competing.
      if (e.cancelable) e.preventDefault();
      setPull(Math.min(MAX_PULL, dy * RESIST));
    };

    const onEnd = () => {
      const s = g.current;
      if (!s.active) return;
      s.active = false;
      if (!s.pulling) return;
      s.pulling = false;
      setDragging(false);
      const dist = pullRef.current;
      if (dist >= HARD_AT) {
        setPull(70);
        try { window.location.reload(); } catch { setPull(0); }
        return;
      }
      if (dist >= SOFT_AT) {
        setBusy(true);
        setPull(54); // hold the spinner open while the re-sync runs
        Promise.resolve()
          .then(() => (onSoftRefresh ? onSoftRefresh() : null))
          .catch(() => { /* a failed sync still releases the spinner */ })
          .finally(() => { setBusy(false); setPull(0); });
        return;
      }
      setPull(0); // not far enough — settle back
    };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd, { passive: true });
    root.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, [rootRef, onSoftRefresh]);

  const phase = busy ? 'busy'
    : pull >= HARD_AT ? 'hard'
    : pull >= SOFT_AT ? 'ready'
    : pull > 0 ? 'pull'
    : 'idle';

  return { pull, busy, dragging, phase };
}

export default usePullToRefresh;
