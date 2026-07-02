import { useState, useEffect, useRef } from "react";
import { pss4Score } from "../engine.js";

// Shared traffic-light tone for slider tints. Kept as local constants
// (rather than imported) so this file is self-contained — these three
// hex values mirror the master palette in CPI.jsx.
const g = "#4F8A5F", y = "#C4902A", r = "#B0553A";

// KSS — Karolinska Sleepiness Scale, single-item 1–9 alertness probe
// (Åkerstedt 1990). Light slider, label updates per stop.
export function KssEditor({ initial, onSave, onCancel }) {
  const [v, setV] = useState(initial ?? 4);
  const labels = { 1: "Extremely alert", 2: "Very alert", 3: "Alert", 4: "Fairly alert", 5: "Neither alert nor sleepy", 6: "Some signs of sleepiness", 7: "Sleepy, no effort to stay awake", 8: "Sleepy, some effort to stay awake", 9: "Fighting sleep" };
  const col = v <= 3 ? g : v <= 6 ? y : r;
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 8, lineHeight: 1.5 }}>
        How alert do you feel <strong>right now</strong>?
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <input type="range" min="1" max="9" value={v} onChange={(e) => setV(parseInt(e.target.value))} style={{ flex: 1, accentColor: "var(--ac)" }} />
        <span style={{ fontSize: 18, fontFamily: "var(--fd)", fontWeight: 200, color: col, minWidth: 22, textAlign: "center" }}>{v}</span>
      </div>
      <div style={{ fontSize: 10, color: col, fontFamily: "var(--fm)", marginBottom: 10, minHeight: 14 }}>{labels[v]}</div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={{ padding: "4px 10px", background: "transparent", border: "1px solid var(--ln)", borderRadius: 4, fontSize: 9, fontFamily: "var(--fm)", color: "var(--mt)", letterSpacing: 1 }}>Cancel</button>
        <button type="button" onClick={() => onSave(v)} style={{ padding: "4px 12px", background: "var(--fg)", border: "none", borderRadius: 4, fontSize: 9, fontFamily: "var(--fm)", color: "var(--bg)", letterSpacing: 1 }}>Save</button>
      </div>
    </div>
  );
}

// PSS-4 — Cohen's 4-item Perceived Stress Scale (1983).
// Items 2 & 3 are reverse-scored inside engine.js#pss4Score.
export function Pss4Survey({ initial, onSave, onCancel }) {
  const [items, setItems] = useState(initial || [null, null, null, null]);
  const qs = [
    "How often have you felt unable to control the important things in your life?",
    "How often have you felt confident about your ability to handle your personal problems?",
    "How often have you felt that things were going your way?",
    "How often have you felt difficulties were piling up so high that you could not overcome them?",
  ];
  const scale = [["Never", 0], ["Almost never", 1], ["Sometimes", 2], ["Fairly often", 3], ["Very often", 4]];
  const done = items.every((v) => v != null);
  const score = done ? pss4Score(items) : null;
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 10, lineHeight: 1.5 }}>
        In the <strong>last week</strong>…
      </div>
      {qs.map((q, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "var(--fg)", fontFamily: "var(--fm)", lineHeight: 1.5, marginBottom: 6 }}>{i + 1}. {q}</div>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            {scale.map(([l, val]) => (
              <button key={val} type="button" onClick={() => { const next = [...items]; next[i] = val; setItems(next); }}
                style={{ flex: 1, padding: "4px 6px", background: items[i] === val ? "var(--fg)" : "transparent", color: items[i] === val ? "var(--bg)" : "var(--mt)", border: `1px solid ${items[i] === val ? "var(--fg)" : "var(--ln)"}`, borderRadius: 4, fontSize: 9, fontFamily: "var(--fm)", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{l}</button>
            ))}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
        <span style={{ fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)" }}>{done ? `Score: ${score}/16 (${score <= 5 ? "low" : score <= 9 ? "moderate" : "high"} stress)` : "Answer all 4"}</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={onCancel} style={{ padding: "4px 10px", background: "transparent", border: "1px solid var(--ln)", borderRadius: 4, fontSize: 9, fontFamily: "var(--fm)", color: "var(--mt)", letterSpacing: 1 }}>Cancel</button>
          <button type="button" onClick={() => done && onSave(items, score)} disabled={!done} style={{ padding: "4px 12px", background: done ? "var(--fg)" : "var(--ln)", border: "none", borderRadius: 4, fontSize: 9, fontFamily: "var(--fm)", color: done ? "var(--bg)" : "var(--mt)", letterSpacing: 1 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// PVT-B — Dinges' brief Psychomotor Vigilance Test. 15 trials, ~60s.
// Reaction-time gold standard for detecting sleep loss. Uses
// onPointerDown for precise timing (onClick has 100–300ms mobile delay).
export function PvtModal({ onClose, onSave }) {
  const [phase, setPhase] = useState("intro"); // intro | waiting | stimulus | between | done
  const [results, setResults] = useState({ rts: [], lapses: 0, falseStarts: 0 });
  const [remaining, setRemaining] = useState(15);
  const stimStartRef = useRef(0);
  const phaseRef = useRef("intro");
  const remainingRef = useRef(15);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { remainingRef.current = remaining; }, [remaining]);

  useEffect(() => {
    if (phase !== "waiting") return;
    const delay = 2000 + Math.random() * 3000;
    const t = setTimeout(() => {
      stimStartRef.current = performance.now();
      setPhase("stimulus");
    }, delay);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "stimulus") return;
    const t = setTimeout(() => {
      setResults((r) => ({ ...r, rts: r.rts.concat(null), lapses: r.lapses + 1 }));
      setRemaining((n) => n - 1);
      setPhase("between");
    }, 1500);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "between") return;
    const t = setTimeout(() => setPhase(remainingRef.current > 0 ? "waiting" : "done"), 600);
    return () => clearTimeout(t);
  }, [phase]);

  const handleTap = (e) => {
    if (e) e.preventDefault();
    const p = phaseRef.current;
    if (p === "waiting") {
      setResults((r) => ({ ...r, falseStarts: r.falseStarts + 1 }));
      return;
    }
    if (p === "stimulus") {
      const rt = Math.round(performance.now() - stimStartRef.current);
      setResults((r) => ({ ...r, rts: r.rts.concat(rt) }));
      setRemaining((n) => n - 1);
      setPhase("between");
    }
  };

  const start = () => {
    setRemaining(15);
    remainingRef.current = 15;
    setResults({ rts: [], lapses: 0, falseStarts: 0 });
    setPhase("waiting");
  };

  const finalStats = (() => {
    const valid = results.rts.filter((x) => typeof x === "number" && x >= 100 && x <= 800);
    if (valid.length === 0) return null;
    const mean = Math.round(valid.reduce((s, v) => s + v, 0) / valid.length);
    const sorted = [...valid].sort((a, b) => a - b);
    const fastest10Count = Math.max(1, Math.floor(valid.length * 0.1));
    const fastest10 = Math.round(sorted.slice(0, fastest10Count).reduce((s, v) => s + v, 0) / fastest10Count);
    return { meanRT: mean, lapses: results.lapses, fastest10, falseStarts: results.falseStarts, validTrials: valid.length };
  })();

  const isActive = phase === "waiting" || phase === "stimulus" || phase === "between";
  const cardBg = phase === "stimulus" ? "#f5d800" : "var(--cd)";
  const cardTxt = phase === "stimulus" ? "#0a0a0a" : "var(--fg)";

  return (
    <div
      onPointerDown={isActive ? handleTap : undefined}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(10,10,10,0.55)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, touchAction: "manipulation", userSelect: "none",
      }}
    >
      <div
        style={{
          width: "100%", maxWidth: 440,
          background: cardBg, color: cardTxt,
          border: "1px solid var(--ln)", borderRadius: 12,
          padding: "28px 24px", textAlign: "center",
          fontFamily: "var(--fm)",
          transition: "background .05s",
          cursor: isActive ? "pointer" : "default",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        }}
      >
      {phase === "intro" && (
        <div onPointerDown={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", marginBottom: 10 }}>Reaction Test · PVT-B</div>
          <div style={{ fontSize: 17, fontWeight: 300, marginBottom: 12, fontFamily: "var(--fd)", lineHeight: 1.4 }}>Tap as fast as you can when the card turns yellow.</div>
          <div style={{ fontSize: 11, lineHeight: 1.7, color: "var(--mt)", marginBottom: 20 }}>15 trials, ~60 seconds. Don't anticipate — tapping early counts as a false start.</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button type="button" onClick={onClose} style={{ padding: "8px 16px", background: "transparent", border: "1px solid var(--ln)", borderRadius: 6, fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1, cursor: "pointer" }}>Cancel</button>
            <button type="button" onClick={start} style={{ padding: "8px 20px", background: "var(--fg)", color: "var(--bg)", border: "none", borderRadius: 6, fontSize: 10, fontFamily: "var(--fm)", letterSpacing: 1, fontWeight: 600, cursor: "pointer" }}>Start</button>
          </div>
        </div>
      )}
      {phase === "waiting" && (
        <div style={{ pointerEvents: "none", padding: "40px 0" }}>
          <div style={{ fontSize: 13, color: "var(--mt)", marginBottom: 6, letterSpacing: 1 }}>Wait for yellow…</div>
          <div style={{ fontSize: 10, color: "var(--mt)", opacity: 0.7 }}>{remaining} trials left</div>
        </div>
      )}
      {phase === "stimulus" && (
        <div style={{ pointerEvents: "none", padding: "40px 0" }}>
          <div style={{ fontSize: 34, fontFamily: "var(--fd)", fontWeight: 300 }}>TAP</div>
        </div>
      )}
      {phase === "between" && (
        <div style={{ pointerEvents: "none", padding: "40px 0" }}>
          <div style={{ fontSize: 11, color: "var(--mt)", opacity: 0.7 }}>{remaining} left</div>
        </div>
      )}
      {phase === "done" && (
        <div onPointerDown={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", marginBottom: 10 }}>Done</div>
          {finalStats ? (
            <>
              <div style={{ fontSize: 36, fontWeight: 200, fontFamily: "var(--fd)", marginBottom: 2, lineHeight: 1.1 }}>{finalStats.meanRT}<span style={{ fontSize: 14, color: "var(--mt)" }}>ms</span></div>
              <div style={{ fontSize: 10, color: "var(--mt)", marginBottom: 18 }}>mean reaction time · {finalStats.validTrials}/{results.rts.length} valid trials</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 22, marginBottom: 18 }}>
                <div><div style={{ fontSize: 17, fontFamily: "var(--fd)", fontWeight: 200 }}>{finalStats.fastest10}</div><div style={{ color: "var(--mt)", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 }}>fastest 10%</div></div>
                <div><div style={{ fontSize: 17, fontFamily: "var(--fd)", fontWeight: 200 }}>{finalStats.lapses}</div><div style={{ color: "var(--mt)", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 }}>lapses</div></div>
                <div><div style={{ fontSize: 17, fontFamily: "var(--fd)", fontWeight: 200 }}>{finalStats.falseStarts}</div><div style={{ color: "var(--mt)", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 }}>false starts</div></div>
              </div>
              <div style={{ fontSize: 10, color: "var(--mt)", lineHeight: 1.6, marginBottom: 18 }}>
                {finalStats.meanRT < 280 ? "Sharp. Well-rested baseline." : finalStats.meanRT < 330 ? "Typical range for rested adults." : finalStats.meanRT < 400 ? "Slower than average — possibly mild fatigue." : "Significantly slowed — consistent with sleep debt or cognitive fatigue."}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, marginBottom: 6, lineHeight: 1.5 }}>No valid trials this round.</div>
              <div style={{ fontSize: 10, color: "var(--mt)", marginBottom: 18, lineHeight: 1.6 }}>
                {results.rts.length} trials · {results.lapses} lapses · {results.falseStarts} false starts. Tap as soon as the card turns yellow — don't wait.
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button type="button" onClick={onClose} style={{ padding: "8px 14px", background: "transparent", border: "1px solid var(--ln)", borderRadius: 6, fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1, cursor: "pointer" }}>Close</button>
            <button type="button" onClick={start} style={{ padding: "8px 14px", background: "transparent", border: "1px solid var(--ln)", borderRadius: 6, fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1, cursor: "pointer" }}>Retry</button>
            {finalStats && <button type="button" onClick={() => onSave(finalStats)} style={{ padding: "8px 20px", background: "var(--fg)", color: "var(--bg)", border: "none", borderRadius: 6, fontSize: 10, fontFamily: "var(--fm)", letterSpacing: 1, fontWeight: 600, cursor: "pointer" }}>Save</button>}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// Manual sleep day editor — gap-fill / suspect-correction tool surfaced
// inside the Body+Context 7-day strip.
export function ManualDayEditor({ initialHours, initialQuality, hasExisting, onSave, onClear, onCancel }) {
  const [hours, setHours] = useState(initialHours ?? 7);
  const [quality, setQuality] = useState(initialQuality ?? 7);
  return (
    <div>
      <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Hours slept</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" onClick={() => setHours((h) => Math.max(0, +(h - 0.25).toFixed(2)))} style={{ width: 24, height: 24, border: "1px solid var(--ln)", background: "transparent", borderRadius: 4, color: "var(--fg)", fontFamily: "var(--fm)" }}>−</button>
            <span style={{ flex: 1, textAlign: "center", fontSize: 16, fontFamily: "var(--fd)", fontWeight: 200 }}>{hours.toFixed(2).replace(/\.?0+$/, "")}h</span>
            <button type="button" onClick={() => setHours((h) => Math.min(14, +(h + 0.25).toFixed(2)))} style={{ width: 24, height: 24, border: "1px solid var(--ln)", background: "transparent", borderRadius: 4, color: "var(--fg)", fontFamily: "var(--fm)" }}>+</button>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>How rested · {quality}</div>
          <input type="range" min="1" max="10" value={quality} onChange={(e) => setQuality(parseInt(e.target.value))} style={{ width: "100%", accentColor: "var(--ac)" }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {hasExisting && <button type="button" onClick={onClear} style={{ padding: "4px 10px", background: "transparent", border: "1px solid var(--ln)", borderRadius: 4, fontSize: 9, fontFamily: "var(--fm)", color: "var(--mt)", letterSpacing: 1 }}>Clear</button>}
        <button type="button" onClick={onCancel} style={{ padding: "4px 10px", background: "transparent", border: "1px solid var(--ln)", borderRadius: 4, fontSize: 9, fontFamily: "var(--fm)", color: "var(--mt)", letterSpacing: 1 }}>Cancel</button>
        <button type="button" onClick={() => onSave(hours, quality)} style={{ padding: "4px 12px", background: "var(--fg)", border: "none", borderRadius: 4, fontSize: 9, fontFamily: "var(--fm)", color: "var(--bg)", letterSpacing: 1 }}>Save</button>
      </div>
    </div>
  );
}
