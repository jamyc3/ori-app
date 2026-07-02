import { useState } from "react";
import {
  detectFileKind, JOURNAL_REPO_KEY,
  readDocxFile, readPdfFile, readTextFile,
  REPO_MAX_TEXT_CHARS,
  loadRepo, repoAdd, saveRepo, transcribeAudioFile, transcribeJournalImage,
} from "./engine.js";

// ─── Local theme (matches Settings.jsx visual language) ─────────────────
const T = {
  bg: "#F7F3EC", paper: "#FBF7EE", card: "#FFFCF6",
  fg: "#1a1a1a",
  muted: "rgba(26,26,26,0.48)",
  faint: "rgba(26,26,26,0.32)",
  line: "rgba(26,26,26,0.10)",
  hair: "rgba(26,26,26,0.06)",
  moss: "#4F8A5F",
  bloom: "#C98660",
  red: "#B0553A",
};
const fb = "'Source Serif 4', Georgia, serif";
const fm = "'DM Mono', ui-monospace, monospace";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function DateRange({ from, to, onFrom, onTo, hint, invalid }) {
  const today = todayISO();
  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.hair}` }}>
      <div style={{ fontFamily: fm, fontSize: 10, letterSpacing: 1.8, color: T.muted, marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
        <span>WHEN IS THIS FROM?</span>
        <span style={{ color: T.faint, letterSpacing: 1.4, fontStyle: "italic" }}>optional</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ display: "block", padding: "10px 12px", background: T.paper, border: `1px solid ${T.line}`, borderRadius: 6 }}>
          <div style={{ fontFamily: fm, fontSize: 10, letterSpacing: 1.4, color: T.muted }}>FROM</div>
          <input type="date" max={today} value={from} onChange={(e) => onFrom(e.target.value)} style={{ width: "100%", border: "none", background: "transparent", padding: 0, marginTop: 4, fontFamily: fb, fontSize: 16, color: T.fg, outline: "none" }} />
        </label>
        <label style={{ display: "block", padding: "10px 12px", background: T.paper, border: `1px solid ${T.line}`, borderRadius: 6 }}>
          <div style={{ fontFamily: fm, fontSize: 10, letterSpacing: 1.4, color: T.muted }}>TO</div>
          <input type="date" max={today} value={to} onChange={(e) => onTo(e.target.value)} style={{ width: "100%", border: "none", background: "transparent", padding: 0, marginTop: 4, fontFamily: fb, fontSize: 16, color: T.fg, outline: "none" }} />
        </label>
      </div>
      <div style={{ marginTop: 10, fontFamily: fb, fontSize: 13, fontStyle: "italic", color: invalid ? T.red : T.muted, lineHeight: 1.5 }}>{hint}</div>
    </div>
  );
}

function ModeButton({ label, hint, active, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: "14px 16px", background: active ? T.paper : T.card,
      border: active ? `1.5px solid ${T.bloom}` : `1px solid ${T.line}`,
      borderRadius: 8, textAlign: "left", cursor: "pointer", fontFamily: fb,
      minHeight: 56, width: "100%",
    }}>
      <div style={{ fontSize: 14, color: T.fg, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 10, fontFamily: fm, letterSpacing: 1.2, color: T.faint, marginTop: 3 }}>{hint}</div>
    </button>
  );
}

export default function ImportJournalSheet({ onChange }) {
  const [mode, setMode] = useState(null); // "paste" | "upload" | "import" | null
  const [pasteText, setPasteText] = useState("");
  const [formFrom, setFormFrom] = useState("");
  const [formTo, setFormTo] = useState("");
  const [pasteError, setPasteError] = useState(null);
  const [photoQueue, setPhotoQueue] = useState([]);

  const resetForm = () => { setPasteText(""); setFormFrom(""); setFormTo(""); setPasteError(null); setPhotoQueue([]); };
  const openMode = (id) => { resetForm(); setMode(mode === id ? null : id); };
  const cancelForm = () => { resetForm(); setMode(null); };

  const rangeInvalid = !!(formFrom && formTo && formTo < formFrom);
  const rangePayload = () => ({ date: formFrom || null, dateEnd: formFrom && formTo && formFrom !== formTo ? formTo : null });
  const rangeHint = !formFrom && !formTo ? "Leave both blank → becomes an undated entry."
    : formFrom && !formTo ? "Single day."
    : formFrom && formTo && formFrom === formTo ? "One day."
    : rangeInvalid ? "TO is earlier than FROM."
    : formFrom && formTo ? "Range across multiple days."
    : "Set FROM first, TO if it's a span.";

  const notify = () => {
    // The 'storage' event doesn't fire in the same tab for own writes.
    // Dispatch a synthetic one so JournalRepo's listener picks up the change.
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: JOURNAL_REPO_KEY }));
    } catch { /* StorageEvent constructor not available in some older runtimes — silent fallback */ }
    if (onChange) onChange();
  };

  const savePaste = () => {
    setPasteError(null);
    const txt = pasteText.trim();
    if (!txt) { setPasteError("Empty — paste some text first."); return; }
    if (txt.length > REPO_MAX_TEXT_CHARS) { setPasteError(`Too long (${txt.length.toLocaleString()} chars). Max ${REPO_MAX_TEXT_CHARS.toLocaleString()}.`); return; }
    if (rangeInvalid) { setPasteError("TO is earlier than FROM."); return; }
    const { date, dateEnd } = rangePayload();
    repoAdd({ source: "text", date, dateEnd, rawText: txt, transcription: txt, confidence: 1.0, notes: "Pasted text.", uploadedAt: new Date().toISOString() });
    cancelForm();
    notify();
  };

  const transcribeOne = async (q) => {
    setPhotoQueue(prev => prev.map(p => p.id === q.id ? { ...p, status: "reading" } : p));
    try {
      let result;
      if (q.kind === "image") result = await transcribeJournalImage(q.file);
      else if (q.kind === "pdf") result = await readPdfFile(q.file);
      else if (q.kind === "docx") result = await readDocxFile(q.file);
      else if (q.kind === "text") result = await readTextFile(q.file);
      else if (q.kind === "audio") result = await transcribeAudioFile(q.file);
      else throw new Error(`Unhandled file kind: ${q.kind}`);
      setPhotoQueue(prev => prev.map(p => p.id === q.id ? { ...p, status: "done", result } : p));
    } catch (err) {
      setPhotoQueue(prev => prev.map(p => p.id === q.id ? { ...p, status: "error", error: err.message } : p));
    }
  };

  const addFiles = (fileList) => {
    const files = Array.from(fileList).slice(0, 20);
    const queued = files.map(f => {
      const kind = detectFileKind(f);
      return {
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        file: f, name: f.name, size: f.size, kind,
        status: kind === "unknown" || kind === "doc" ? "error" : "pending",
        error: kind === "doc" ? "Legacy .doc not supported — export as .docx or PDF." : kind === "unknown" ? `Unsupported file type. Use .txt, .docx, .pdf, image, or audio.` : null,
        result: null,
      };
    });
    setPhotoQueue(prev => [...prev, ...queued]);
    queued.filter(q => q.status === "pending").forEach(transcribeOne);
  };

  const savePhotoEntry = (q) => {
    if (!q.result || rangeInvalid) return;
    const { date: rangeDate, dateEnd } = rangePayload();
    const finalDate = rangeDate || q.result.detectedDate || null;
    const finalEnd = rangeDate ? dateEnd : null;
    const srcMap = { image: "image", pdf: "pdf", docx: "docx", text: "text", audio: "audio" };
    repoAdd({
      source: srcMap[q.kind] || "text",
      kind: q.kind, date: finalDate, dateEnd: finalEnd,
      dateText: q.result.dateText || null,
      rawText: q.result.transcription, transcription: q.result.transcription,
      confidence: q.result.confidence,
      notes: q.result.notes || `From ${q.kind}: ${q.name}`,
      fileName: q.name, fileBytes: q.size,
      illegibleCount: q.result.illegibleCount || 0,
      uploadedAt: new Date().toISOString(),
    });
    setPhotoQueue(prev => prev.filter(p => p.id !== q.id));
    notify();
  };

  const discardPhoto = (id) => setPhotoQueue(prev => prev.filter(p => p.id !== id));
  const saveAllReady = () => photoQueue.filter(q => q.status === "done").forEach(savePhotoEntry);

  // Pull importable entries out of any of the three JSON shapes we support:
  //   1. Full Ori backup ({ schema: "ori-backup/1", entries: [{key,value}] }) —
  //      the file Settings → Backup produces. Extract both the journal repo
  //      (cpi_journal_repo) and the daily check-in history (cpi-v2-data) so
  //      the calendar gets populated with everything the user wrote on the
  //      web side, not just paste/upload entries.
  //   2. A naked journal-repo export ({ entries: [{ rawText, ... }] }).
  //   3. A bare array of entries.
  // Returns { journalEntries, historyEntries } — both arrays of objects in
  // their canonical shapes ready to merge.
  const extractFromAnyShape = (data) => {
    const out = { journalEntries: [], historyEntries: [], letterEntries: [] };
    if (!data) return out;

    // Shape 1: Ori backup bundle.
    if (data.schema === "ori-backup/1" && Array.isArray(data.entries)) {
      for (const kv of data.entries) {
        if (!kv?.key || typeof kv.value !== "string") continue;
        if (kv.key === "cpi_journal_repo") {
          try {
            const repo = JSON.parse(kv.value);
            if (Array.isArray(repo?.entries)) out.journalEntries = repo.entries;
          } catch { /* skip malformed */ }
        } else if (kv.key === "cpi-v2-data") {
          try {
            const parsed = JSON.parse(kv.value);
            // cpi-v2-data may be an array (older) or an object with .history.
            const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.history) ? parsed.history : null);
            if (arr) out.historyEntries = arr;
          } catch { /* skip malformed */ }
        } else if (/^cpi_letter_\d{4}-\d{2}-\d{2}$/.test(kv.key)) {
          // Per-day saved Claude readings ("letters"). The Journal reader
          // and the "Tonight's Reading" card both look these up by key —
          // without restoring them, every imported day shows the writing
          // but no synthesised letter, and the user has to spend a Claude
          // call to regenerate something the backup already contains.
          out.letterEntries.push({ key: kv.key, value: kv.value });
        }
      }
      return out;
    }

    // Shape 2 & 3: bare entries array or { entries: [...] }.
    const arr = Array.isArray(data.entries) ? data.entries : Array.isArray(data) ? data : null;
    if (arr) out.journalEntries = arr;
    return out;
  };

  const importJson = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const { journalEntries, historyEntries, letterEntries = [] } = extractFromAnyShape(data);
      if (journalEntries.length === 0 && historyEntries.length === 0) {
        throw new Error("Couldn't find any journal entries in this file.");
      }

      const { date: rangeStart, dateEnd: rangeEnd } = rangePayload();
      let added = 0;
      let historyAdded = 0;
      let lettersAdded = 0;

      // Restore per-day saved letters first so the Journal reader has them
      // ready by the time the history-driven UI re-renders. We only write
      // keys the device doesn't already hold — that way an iOS-side letter
      // (e.g. one the user just generated locally) isn't clobbered by a
      // stale copy of the same day from the backup.
      for (const { key, value } of letterEntries) {
        try {
          if (localStorage.getItem(key) == null) {
            localStorage.setItem(key, value);
            lettersAdded++;
          }
        } catch { /* quota / shim error — skip */ }
      }

      // Journal-repo entries (paste, upload, photo, audio).
      journalEntries.forEach(e => {
        if (e && (e.rawText || e.transcription)) {
          const fillStart = e.date ? null : rangeStart;
          const fillEnd = e.date ? null : rangeEnd;
          repoAdd({
            source: e.source || "text",
            date: e.date || fillStart || null,
            dateEnd: e.dateEnd || fillEnd || null,
            rawText: e.rawText || e.transcription || "",
            transcription: e.transcription || e.rawText || "",
            confidence: typeof e.confidence === "number" ? e.confidence : 1.0,
            notes: e.notes || "Imported from file",
            dateText: e.dateText || null,
            uploadedAt: e.uploadedAt || new Date().toISOString(),
          });
          added++;
        }
      });

      // Daily check-in entries from cpi-v2-data restore into THAT key —
      // not into the journal repo. The Journal tab already pulls
      // check-ins from cpi-v2-data via the `checkins` prop wired in
      // CPI.jsx, so they show on the calendar automatically. Restoring
      // here is what lights up the Patterns tab (which reads `history`
      // alongside the You-tab biometric cards). Without this, every
      // imported day shows on the calendar but Patterns stays empty.
      if (historyEntries.length > 0) {
        // Cleanup: previous versions of this import projected the
        // historyEntries into cpi_journal_repo with source:"checkin"
        // and notes:"Imported from backup (daily reading)". Those rows
        // would now appear twice once cpi-v2-data is restored — the
        // Journal calendar pulls from BOTH stores. Sweep them up so
        // each imported day shows once. No-op for users who didn't
        // import under the old code.
        try {
          const repo = loadRepo();
          if (repo && Array.isArray(repo.entries)) {
            const cleaned = repo.entries.filter(e =>
              !(e?.source === "checkin" && e?.notes === "Imported from backup (daily reading)")
            );
            if (cleaned.length !== repo.entries.length) {
              // Removing backup-duplicate markers is a deliberate shrink.
              saveRepo({ ...repo, entries: cleaned }, { allowShrink: true });
            }
          }
        } catch { /* ignore */ }

        let current = [];
        try {
          const raw = localStorage.getItem("cpi-v2-data");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) current = parsed;
          }
        } catch { /* fall through with empty array */ }
        // Dedupe by entry.date (ISO timestamp string). If a timestamp is
        // present in both sides we trust the iOS side — it could include
        // newer local edits not in the backup.
        const seen = new Set(current.map(e => e?.date).filter(Boolean));
        const merged = [...current];
        for (const e of historyEntries) {
          if (!e?.date || seen.has(e.date)) continue;
          merged.push(e);
          seen.add(e.date);
          historyAdded++;
        }
        // Sort newest-first — CPI's reads assume reverse-chronological.
        merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        try { localStorage.setItem("cpi-v2-data", JSON.stringify(merged)); } catch { /* quota — non-fatal */ }
      }

      cancelForm();
      notify();
      // If we restored history, the in-memory React state is now stale.
      // Reloading is the simplest way to make Patterns / You-tab pick
      // up the freshly-merged history — they only read the storage key
      // on mount. The alert lets the user see what happened before the
      // reload kicks in.
      if (historyAdded > 0 || lettersAdded > 0) {
        const parts = [];
        if (added > 0) parts.push(`${added} journal entr${added === 1 ? "y" : "ies"}`);
        if (historyAdded > 0) parts.push(`${historyAdded} daily reading${historyAdded === 1 ? "" : "s"}`);
        if (lettersAdded > 0) parts.push(`${lettersAdded} saved letter${lettersAdded === 1 ? "" : "s"}`);
        alert(`Imported ${parts.join(", ")}. Reloading so Patterns lights up…`);
        setTimeout(() => { try { window.location.reload(); } catch { /* ignore */ } }, 300);
      } else {
        alert(`Imported ${added} entries.`);
      }
    } catch (e) {
      alert(`Import failed: ${e.message}`);
    }
  };

  const tillUnder = () => {
    if (!window.confirm("Till under the imported journals? Your daily check-ins stay — only the paste/upload entries are removed.")) return;
    // Do what the prompt promises: imported entries go, daily check-ins
    // stay. (This used to removeItem the whole repo — check-ins included.)
    try {
      const repo = loadRepo();
      const kept = (repo.entries || []).filter((e) => e?.source === "checkin");
      saveRepo({ ...repo, entries: kept }, { allowShrink: true });
    } catch { /* repo unreadable — leave it untouched */ }
    notify();
  };

  return (
    <div style={{ padding: "16px 22px 28px", fontFamily: fb, color: T.fg }}>
      <div style={{ fontFamily: fm, fontSize: 10, letterSpacing: 2, color: T.muted, marginBottom: 12 }}>IMPORT JOURNAL</div>
      <div style={{ fontFamily: fb, fontSize: 14, lineHeight: 1.6, color: T.muted, marginBottom: 16 }}>
        Bring in writing from outside the app — text, photos of notebook pages, PDFs, audio recordings.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ModeButton label="Paste text" hint="ANY TEXT · WITH OPTIONAL DATE RANGE" active={mode === "paste"} onClick={() => openMode("paste")} />
        <ModeButton label="Upload pages" hint="PHOTO · PDF · AUDIO · TEXT · DOCX" active={mode === "upload"} onClick={() => openMode("upload")} />
        <ModeButton label="Import .json" hint="EXPORT BUNDLE" active={mode === "import"} onClick={() => openMode("import")} />
      </div>

      {/* Paste */}
      {mode === "paste" && (
        <div style={{ marginTop: 14, padding: 14, background: T.card, border: `1px solid ${T.line}`, borderRadius: 6 }}>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste a journal entry…" rows={6} style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", background: T.paper, border: `1px solid ${T.line}`, borderRadius: 4, fontFamily: fb, fontSize: 16, color: T.fg, lineHeight: 1.6, resize: "vertical" }} />
          <div style={{ marginTop: 6, fontFamily: fm, fontSize: 9, letterSpacing: 1.2, color: pasteText.length > REPO_MAX_TEXT_CHARS ? T.red : T.faint, textAlign: "right" }}>
            {pasteText.length.toLocaleString()} / {REPO_MAX_TEXT_CHARS.toLocaleString()}
          </div>
          <DateRange from={formFrom} to={formTo} onFrom={setFormFrom} onTo={setFormTo} hint={rangeHint} invalid={rangeInvalid} />
          {pasteError && <div style={{ fontSize: 11, color: T.red, marginTop: 8 }}>{pasteError}</div>}
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={cancelForm} style={{ padding: "12px 18px", minHeight: 44, background: "transparent", border: `1px solid ${T.line}`, borderRadius: 6, cursor: "pointer", fontFamily: fm, fontSize: 11, letterSpacing: 1.4, color: T.muted }}>CANCEL</button>
            <button type="button" disabled={rangeInvalid} onClick={savePaste} style={{ padding: "12px 18px", minHeight: 44, background: rangeInvalid ? T.line : T.moss, color: "#fff", border: "none", borderRadius: 6, cursor: rangeInvalid ? "default" : "pointer", fontFamily: fm, fontSize: 11, letterSpacing: 1.4 }}>SAVE</button>
          </div>
        </div>
      )}

      {/* Upload */}
      {mode === "upload" && (
        <div style={{ marginTop: 14, padding: 14, background: T.card, border: `1px solid ${T.line}`, borderRadius: 6 }}>
          <label style={{ display: "block", padding: "26px 14px", background: T.paper, border: `1.5px dashed ${T.line}`, borderRadius: 8, textAlign: "center", cursor: "pointer", minHeight: 88 }}>
            <input type="file" accept=".txt,.md,.docx,.pdf,image/*,audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
            <div style={{ fontFamily: fb, fontSize: 14, color: T.fg, marginBottom: 6 }}>Tap to choose files</div>
            <div style={{ fontFamily: fm, fontSize: 10, letterSpacing: 1.2, color: T.faint }}>PHOTO · PDF · AUDIO · TEXT · DOCX — up to 20 at once</div>
          </label>
          <DateRange from={formFrom} to={formTo} onFrom={setFormFrom} onTo={setFormTo} hint={rangeHint} invalid={rangeInvalid} />
          {photoQueue.length > 0 && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {photoQueue.map(q => {
                const kindLabel = { image: "Photo", pdf: "PDF", docx: "Word", text: "Text", audio: "Audio" }[q.kind] || "File";
                const readingLabel = { image: "OCR…", pdf: "Extracting…", docx: "Parsing…", text: "Reading…", audio: "Transcribing…" }[q.kind] || "Reading…";
                return (
                  <div key={q.id} style={{ padding: 12, background: T.paper, border: `1px solid ${T.line}`, borderRadius: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 8 }}>
                      <div style={{ fontSize: 13, fontFamily: fb, color: T.fg, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 10, letterSpacing: 1.4, fontFamily: fm, color: T.moss, marginRight: 8 }}>{kindLabel.toUpperCase()}</span>
                        {q.name} <span style={{ color: T.muted, fontSize: 11 }}>({(q.size / 1024).toFixed(0)} KB)</span>
                      </div>
                      <div style={{ fontSize: 10, letterSpacing: 1.4, fontFamily: fm, color: q.status === "done" ? T.moss : q.status === "error" ? T.red : T.muted }}>
                        {q.status === "pending" && "QUEUED"}
                        {q.status === "reading" && readingLabel.toUpperCase()}
                        {q.status === "done" && "READY"}
                        {q.status === "error" && "ERROR"}
                      </div>
                    </div>
                    {q.status === "error" && <div style={{ fontSize: 11, color: T.red, marginBottom: 8 }}>{q.error}</div>}
                    {q.status === "done" && q.result && (
                      <>
                        <div style={{ fontFamily: fm, fontSize: 10, letterSpacing: 1.4, color: T.muted, marginBottom: 6 }}>
                          CONFIDENCE {Math.round((q.result.confidence || 0) * 100)}%
                          {q.result.illegibleCount > 0 && ` · ${q.result.illegibleCount} ILLEGIBLE`}
                          {q.result.dateText && ` · DATE: ${q.result.dateText.toUpperCase()}`}
                        </div>
                        <div style={{ fontSize: 12, lineHeight: 1.6, color: T.fg, fontFamily: fb, padding: "10px 12px", background: T.card, border: `1px solid ${T.hair}`, borderRadius: 4, maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap", marginBottom: 8 }}>
                          {q.result.transcription}
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                          <button type="button" onClick={() => discardPhoto(q.id)} style={{ padding: "12px 16px", minHeight: 44, background: "transparent", border: `1px solid ${T.line}`, borderRadius: 6, cursor: "pointer", fontFamily: fm, fontSize: 11, letterSpacing: 1.4, color: T.muted }}>DISCARD</button>
                          <button type="button" disabled={rangeInvalid} onClick={() => savePhotoEntry(q)} style={{ padding: "12px 16px", minHeight: 44, background: rangeInvalid ? T.line : T.moss, color: "#fff", border: "none", borderRadius: 6, cursor: rangeInvalid ? "default" : "pointer", fontFamily: fm, fontSize: 11, letterSpacing: 1.4 }}>SAVE</button>
                        </div>
                      </>
                    )}
                    {q.status === "error" && (
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button type="button" onClick={() => discardPhoto(q.id)} style={{ padding: "12px 16px", minHeight: 44, background: "transparent", border: `1px solid ${T.line}`, borderRadius: 6, cursor: "pointer", fontFamily: fm, fontSize: 11, letterSpacing: 1.4, color: T.muted }}>DISMISS</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {photoQueue.some(q => q.status === "done") && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" disabled={rangeInvalid} onClick={saveAllReady} style={{ padding: "12px 18px", minHeight: 44, background: rangeInvalid ? T.line : T.moss, color: "#fff", border: "none", borderRadius: 6, cursor: rangeInvalid ? "default" : "pointer", fontFamily: fm, fontSize: 11, letterSpacing: 1.4 }}>SAVE ALL READY</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Import */}
      {mode === "import" && (
        <div style={{ marginTop: 14, padding: 14, background: T.card, border: `1px solid ${T.line}`, borderRadius: 6 }}>
          <label style={{ display: "block", padding: "22px 14px", background: T.paper, border: `1.5px dashed ${T.line}`, borderRadius: 4, textAlign: "center", cursor: "pointer" }}>
            <input type="file" accept=".json,application/json" onChange={(e) => { importJson(e.target.files?.[0]); e.target.value = ""; }} style={{ display: "none" }} />
            <div style={{ fontFamily: fb, fontSize: 13, color: T.fg, marginBottom: 4 }}>Choose a .json file</div>
            <div style={{ fontFamily: fm, fontSize: 10, letterSpacing: 1.2, color: T.faint }}>EXPORT BUNDLE — {"{ entries: [...] }"}</div>
          </label>
          <DateRange from={formFrom} to={formTo} onFrom={setFormFrom} onTo={setFormTo} hint={rangeHint} invalid={rangeInvalid} />
          <div style={{ marginTop: 6, fontFamily: fb, fontSize: 11, fontStyle: "italic", color: T.muted }}>
            A range here only fills in entries that <em>don't</em> already have a date.
          </div>
        </div>
      )}

      {/* Till Under (destructive) */}
      <div style={{ marginTop: 28, paddingTop: 16, borderTop: `1px solid ${T.hair}` }}>
        <div style={{ fontFamily: fm, fontSize: 10, letterSpacing: 2, color: T.muted, marginBottom: 8 }}>DATA</div>
        <button type="button" onClick={tillUnder} style={{
          width: "100%", padding: "14px 16px", textAlign: "left",
          background: "transparent", border: `1px solid ${T.line}`, borderRadius: 8,
          fontFamily: fb, color: T.red, fontSize: 14, cursor: "pointer",
        }}>
          <div style={{ fontWeight: 500 }}>Till under journal</div>
          <div style={{ fontFamily: fm, fontSize: 9, letterSpacing: 1.2, marginTop: 3, color: T.faint }}>REMOVES IMPORTED ENTRIES · CHECK-INS STAY</div>
        </button>
      </div>
    </div>
  );
}
