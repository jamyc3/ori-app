import { useState } from "react";
import { needsSleepReview } from "../engine.js";

// Reflect-mode transparency banner. Shown only when the user has chosen
// the words-only path so they understand why the dashboard is quieter
// and what scientific signals it can still produce. Click "Add body
// signals" → opens Integrations panel for Oura / Apple Health connect.
export function ReflectTransparencyBanner({ onAddBody }) {
  const [collapsed, setCollapsed] = useState(false);
  const goldRule = "rgba(184,134,11,0.55)";
  const ink = "var(--fg)";
  const mt = "var(--mt)";
  const ln = "var(--ln)";
  return (
    <div style={{
      border: `1px solid ${ln}`,
      borderRadius: 12,
      padding: collapsed ? "12px 18px" : "20px 22px 22px",
      background: "var(--cd)",
      marginBottom: 20,
      transition: "padding .35s ease",
      fontFamily: "var(--fb)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        {collapsed ? (
          <span style={{ fontFamily: "var(--fm)", fontSize: 11, letterSpacing: 1.8, textTransform: "uppercase", color: mt }}>
            Reflect mode · words only
          </span>
        ) : (
          <h2 style={{ fontFamily: "var(--fd)", fontWeight: 400, fontSize: 22, lineHeight: 1.2, letterSpacing: "-0.01em", margin: 0, color: ink }}>
            A complete path, without the ring.
          </h2>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: "transparent",
            border: `1px solid ${ln}`,
            borderRadius: 999,
            padding: "4px 10px",
            fontFamily: "var(--fm)",
            fontSize: 9,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            color: mt,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >{collapsed ? "Show" : "Hide"}</button>
      </div>
      {!collapsed && (
        <>
          <div style={{ marginTop: 14, fontSize: 14, color: ink, lineHeight: 1.6, opacity: 0.85 }}>
            The fullest read combines your words with your body — sleep, heart, and breath can hold things language alone misses. You've chosen <b>Reflect</b>, and that's a scientifically sound path in its own right.
          </div>
          <div style={{ marginTop: 10, fontSize: 12.5, color: mt, lineHeight: 1.6, fontStyle: "italic" }}>
            Even with Oura connected, only activity is read here — sleep, heart, and breath stay private to your device.
          </div>
          <ul style={{ margin: "14px 0 12px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { b: "Alertness", body: "a validated sleepiness scale", cite: "Karolinska · Åkerstedt 1990" },
              { b: "Stress", body: "a 4-item clinical instrument", cite: "PSS-4 · Cohen 1983" },
              { b: "Language signals", body: "expressive-writing markers in your seeds", cite: "LIWC · Pennebaker 1990→" },
              { b: "Daily reading", body: "a single honest read once you've seeded your day", cite: null },
              { b: "Weekly tier", body: "Steady · Stretched · Heavy · Low tide — after 7 days", cite: null },
            ].map((it, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: ink, opacity: 0.82, paddingLeft: 14, position: "relative" }}>
                <span style={{ position: "absolute", left: 0, color: goldRule, fontWeight: 600 }}>·</span>
                <b style={{ fontWeight: 500 }}>{it.b}</b> — {it.body}
                {it.cite && <span style={{ fontFamily: "var(--fm)", fontSize: 10, color: mt, marginLeft: 6 }}>{it.cite}</span>}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={onAddBody}
              style={{
                background: "transparent",
                border: "none",
                fontFamily: "var(--fm)",
                fontSize: 10,
                letterSpacing: 1.8,
                textTransform: "uppercase",
                color: mt,
                cursor: "pointer",
                padding: "6px 0",
              }}
            >Add body signals → <span style={{ opacity: 0.6, marginLeft: 4 }}>↗</span></button>
            <span style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.8, textTransform: "uppercase", color: mt, opacity: 0.6 }}>
              Reflect · words only
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// Parity banner. When our own suspect-reading detector flags today's
// wearable sleep (and the user hasn't corrected it yet), surface a prompt
// with the actual Oura value struck through and a CTA to override.
// Parity rule: the value below the strike-through is what Ori still
// displays everywhere else until the user overrides. Oura always wins by
// default; this banner is the one escape hatch when Oura got it wrong.
export function SleepReviewBanner({ entry, onCorrect }) {
  if (!entry || !needsSleepReview(entry)) return null;
  const mins = entry.totalSleepMin;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const pretty = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return (
    <div style={{
      margin: "0 0 14px",
      padding: "12px 14px",
      background: "rgba(184,134,11,0.08)",
      border: "1px solid rgba(184,134,11,0.6)",
      borderRadius: 8,
      display: "flex",
      alignItems: "flex-start",
      gap: 12,
      fontFamily: "var(--fm)",
    }}>
      <span style={{ fontSize: 16, lineHeight: 1, marginTop: 1, color: "rgb(184,134,11)" }}>⚠</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.5, marginBottom: 6 }}>
          Oura logged only <span style={{ textDecoration: "line-through", color: "rgb(184,134,11)" }}>{pretty}</span> last night — that doesn't match your usual pattern. Enter the real hours so the rest of your readings are accurate.
        </div>
        <button
          type="button"
          onClick={onCorrect}
          style={{
            padding: "6px 12px",
            background: "var(--fg)",
            border: "none",
            borderRadius: 4,
            fontSize: 10,
            fontFamily: "var(--fm)",
            color: "var(--bg)",
            letterSpacing: 1,
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >Enter real sleep →</button>
      </div>
    </div>
  );
}
