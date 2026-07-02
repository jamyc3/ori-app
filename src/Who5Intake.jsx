// WHO-5 daily intake sheet — five short statements, 6-point dot scale
// per item. Live score in the footer; "Save" enables once all five
// items have an answer. Writes via who5.js and emits cpi:who5-updated
// so the You tab tile updates without a refresh.

import { useState } from "react";
import { WHO5_ITEMS, WHO5_SCALE, scoreWho5, bandFor, saveTodayWho5 } from "./who5.js";

const T = {
  bg:    "#F7F3EC", paper: "#FBF7EE", card: "#FFFCF6",
  ink:   "#1a1a1a", soft:  "#2B2824", muted: "#6F695E", faint: "#B8B09D",
  hair:  "rgba(26,26,26,0.07)", line:  "rgba(26,26,26,0.12)",
  leaf:  "#3F5B39", moss:  "#4F8A5F",
};
const fd = "'Playfair Display', Georgia, serif";
const fb = "'Source Serif 4', Georgia, serif";
const fm = "'DM Mono', ui-monospace, monospace";
const fs = "'Inter', system-ui, -apple-system, sans-serif";

export default function Who5Intake({ onClose, onSubmit }) {
  const [items, setItems] = useState([null, null, null, null, null]);
  const allAnswered = items.every((v) => typeof v === "number");
  const liveScore = allAnswered ? scoreWho5(items) : null;
  const liveBand = liveScore != null ? bandFor(liveScore) : null;

  const setAt = (i, v) =>
    setItems((prev) => {
      const next = prev.slice();
      next[i] = v;
      return next;
    });

  const submit = () => {
    if (!allAnswered) return;
    const saved = saveTodayWho5(items);
    if (saved && typeof onSubmit === "function") onSubmit(saved);
    if (typeof onClose === "function") onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 400,
        background: "rgba(28,24,20,0.40)",
        display: "flex", alignItems: "stretch", justifyContent: "center",
        padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 16px)",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.bg, borderRadius: 20,
          maxWidth: 480, width: "100%", margin: "auto",
          padding: "28px 22px 22px",
          boxShadow: "0 30px 60px rgba(28,24,20,0.25)",
          fontFamily: fs,
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute", top: 10, right: 10,
            width: 40, height: 40, borderRadius: "50%",
            background: "transparent", border: "none", cursor: "pointer", color: T.ink,
            fontSize: 22, lineHeight: 1, padding: 0, fontFamily: fb,
          }}
        >×</button>

        <div style={{
          fontFamily: fm, fontSize: 10, letterSpacing: "0.18em",
          textTransform: "uppercase", color: T.muted, marginBottom: 6,
        }}>Daily check-in</div>
        <h2 style={{
          fontFamily: fd, fontStyle: "italic", fontWeight: 300,
          fontSize: 26, lineHeight: 1.2, letterSpacing: "-0.01em",
          color: T.ink, margin: "0 0 4px",
        }}>Five quick ones.</h2>
        <p style={{
          fontFamily: fb, fontStyle: "italic", fontSize: 14, lineHeight: 1.5,
          color: T.muted, margin: "0 0 18px", maxWidth: "32em",
        }}>How much of today did each one feel true?</p>

        {WHO5_ITEMS.map((item, i) => (
          <div key={item.id} style={{ marginBottom: 16 }}>
            <div style={{
              fontFamily: fs, fontSize: 14, lineHeight: 1.5, color: T.soft,
              margin: "0 0 8px",
            }}>{item.body}</div>
            <div style={{
              display: "flex", gap: 6, justifyContent: "space-between",
              alignItems: "center",
            }}>
              {WHO5_SCALE.map(({ v, label }) => {
                const selected = items[i] === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAt(i, v)}
                    aria-label={`${item.short}: ${label}`}
                    title={label}
                    style={{
                      width: 36, height: 36, borderRadius: "50%",
                      border: `1.5px solid ${selected ? T.leaf : T.line}`,
                      background: selected ? T.leaf : "transparent",
                      color: selected ? T.bg : T.muted,
                      fontFamily: fm, fontSize: 11, lineHeight: 1,
                      cursor: "pointer", padding: 0,
                      display: "grid", placeItems: "center",
                      transition: "background 140ms ease, color 140ms ease, transform 140ms ease",
                      transform: selected ? "scale(1.05)" : "none",
                    }}
                  >{v}</button>
                );
              })}
            </div>
          </div>
        ))}

        <div style={{
          display: "flex", justifyContent: "space-between",
          fontFamily: fm, fontSize: 9, letterSpacing: "0.10em",
          textTransform: "uppercase", color: T.faint,
          marginTop: -2, marginBottom: 18,
        }}>
          <span>At no time</span><span>All of the time</span>
        </div>

        <div style={{
          padding: "14px 16px",
          background: T.card, border: `1px solid ${T.hair}`,
          borderRadius: 12,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 12,
        }}>
          <div>
            <div style={{
              fontFamily: fm, fontSize: 9, letterSpacing: "0.16em",
              textTransform: "uppercase", color: T.muted, marginBottom: 4,
            }}>Today's score</div>
            <div style={{
              fontFamily: fd, fontStyle: "italic", fontWeight: 300,
              fontSize: 26, lineHeight: 1,
              color: liveScore == null ? T.faint : T.ink,
            }}>
              {liveScore == null ? "—" : liveScore}
              {liveBand && (
                <span style={{
                  fontFamily: fs, fontStyle: "normal", fontSize: 12,
                  color: T.muted, marginLeft: 8, fontWeight: 400,
                }}>{liveBand.label}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!allAnswered}
            style={{
              background: allAnswered ? T.ink : "rgba(26,26,26,0.18)",
              color: T.bg,
              border: "none", borderRadius: 999,
              padding: "10px 22px",
              fontFamily: fs, fontWeight: 500, fontSize: 14,
              cursor: allAnswered ? "pointer" : "default",
              transition: "background 140ms ease",
            }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}
