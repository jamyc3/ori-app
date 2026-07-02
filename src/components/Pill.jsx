// Pill — small selectable chip used across surveys, settings, and
// chronotype/mode selectors. Active state inverts to ink-on-paper.
export function Pill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 12px",
        background: active ? "var(--fg)" : "transparent",
        color: active ? "var(--bg)" : "var(--mt)",
        border: `1px solid ${active ? "var(--fg)" : "var(--ln)"}`,
        borderRadius: 20,
        fontSize: 10,
        fontFamily: "var(--fm)",
        letterSpacing: 1,
        transition: "all .2s",
      }}
    >{children}</button>
  );
}
