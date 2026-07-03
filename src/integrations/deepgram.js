/* ═══════════════════════════════════════════
   VOICE INPUT — Deepgram Nova 3 (streaming)
   Direct browser WebSocket. The key is shipped in
   the bundle because gateways can't proxy WS; rotate
   VITE_DEEPGRAM_API_KEY independently from server keys.
   ═══════════════════════════════════════════ */

import { useState, useEffect, useCallback, useRef } from "react";
import { registerPlugin, Capacitor } from "@capacitor/core";
import { keepScreenAwake, allowScreenSleep } from "../keepAwake.js";
import { withKeyterms } from "../voiceVocabulary.js";

// Native bridge (iOS): makes Ori a good audio citizen so it coexists with other
// apps. beginVoiceSession() (called right before getUserMedia) applies a
// mix-friendly, Bluetooth-allowing audio session so Spotify/YouTube keep playing
// and AirPods/headset mic + Bluetooth playback all work; endVoiceSession() hands
// audio back when capture stops. Both no-op on web / non-iOS.
// See ios/App/App/MicRouteGuard.swift.
const MicRoute = registerPlugin("MicRoute");
const onIOS = () => Capacitor.getPlatform?.() === "ios";
async function beginVoiceSession() {
  if (!onIOS()) return;
  try { await MicRoute.beginVoiceSession(); } catch { /* bridge absent on an older build */ }
}
function endVoiceSession() {
  if (!onIOS()) return;
  try { MicRoute.endVoiceSession(); } catch { /* fire-and-forget */ }
}

export const DEEPGRAM_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY;

// Prefer a SHORT-LIVED key minted by our proxy (10-min TTL, usage-only scope)
// over the long-lived bundled one — an extracted bundle key then buys an
// attacker nothing durable. Cached until just before expiry; every failure
// path falls back to the bundled key so voice never breaks on a proxy hiccup
// or an older server. The iOS fetch shim routes '/proxy/…' to production.
let _dgSession = null; // { key, expiresAt }
// Deepgram health memory: set when the server can't mint (its account is down)
// or a live socket dies. While recent, start() skips Deepgram's doomed
// handshake and opens the AssemblyAI stream directly — one hop, less latency.
// Persisted so a fresh app launch during an outage doesn't re-pay the
// discovery cost on its first tap; cleared the moment a Deepgram socket opens.
const DG_DOWN_KEY = 'ori_dg_down_at';
let _dgUnhealthyAt = 0;
try { _dgUnhealthyAt = Number(localStorage.getItem(DG_DOWN_KEY)) || 0; } catch { /* storage unavailable */ }
const DG_RETRY_MS = 5 * 60_000; // re-try Deepgram after 5 min (auto-recovery)
function markDgDown() {
  _dgUnhealthyAt = Date.now();
  try { localStorage.setItem(DG_DOWN_KEY, String(_dgUnhealthyAt)); } catch { /* noop */ }
}
function markDgUp() {
  _dgUnhealthyAt = 0;
  try { localStorage.removeItem(DG_DOWN_KEY); } catch { /* noop */ }
}

// Every network step on the mic's critical path gets a hard deadline — a hung
// fetch must fail into the next tier in seconds, never leave the user waiting.
function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

async function getDeepgramKey() {
  if (_dgSession && Date.now() < _dgSession.expiresAt) return _dgSession.key;
  try {
    const res = await fetchWithTimeout('/proxy/deepgram/token', { method: 'POST' }, 4000);
    if (res.ok) {
      const j = await res.json();
      if (j?.key) {
        _dgSession = { key: j.key, expiresAt: typeof j.expiresAt === 'number' ? j.expiresAt : Date.now() + 8 * 60_000 };
        return j.key;
      }
    } else if (res.status === 502 || res.status === 503) {
      markDgDown(); // server tried Deepgram and Deepgram refused
    }
  } catch { /* offline or older server — bundled key below */ }
  return DEEPGRAM_KEY;
}
// The live-stream URL is built per-session so the STT language can vary — English
// by default, Bengali (bn) for reflect-mode बांग्ला users. Everything else is fixed.
// mip_opt_out=true excludes the audio from Deepgram's Model Improvement Program
// (retained only for the duration of the request) — the privacy policy promises
// user audio is never used to train models, so this parameter is load-bearing.
export const buildDeepgramUrl = (language = "en-US") =>
  `wss://api.deepgram.com/v1/listen?model=nova-3&language=${encodeURIComponent(language)}&smart_format=true&interim_results=true&punctuate=true&endpointing=250&vad_events=true&no_delay=true&mip_opt_out=true`;
export const DEEPGRAM_URL = buildDeepgramUrl();

// Reflect-mode language pref. 'bn' when the user chose বাংলা, else English.
// Set by the reflect language toggle; read by the two reflect voice surfaces
// (daily seed + part reflections) to route STT to Bengali — and nothing else.
export const REFLECT_LANG_KEY = "ori_reflect_lang";
export function reflectSttLanguage() {
  try { return localStorage.getItem(REFLECT_LANG_KEY) === "bn" ? "bn" : "en-US"; }
  catch { return "en-US"; }
}

const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } };

// ─── BATCH FALLBACK (Deepgram outage) ────────────────────────────────────
// When the live socket can't run (Deepgram account down, key dead), the mic
// keeps capturing raw PCM and ships ~7s windows to /proxy/deepgram, whose
// server-side backup chain (Deepgram → OpenAI whisper → Google STT) returns a
// Deepgram-shaped transcript. Words arrive in chunks instead of live interim
// text — degraded, but the mic never just dies.
const FB_WINDOW_MS = 7000;

// ─── ASSEMBLYAI LIVE BACKUP ──────────────────────────────────────────────
// Second STREAMING engine. When Deepgram's socket can't run, the live mic
// switches to AssemblyAI Universal-Streaming (wss) via a short-lived token
// minted by /proxy/aai/token — interim + final text keep flowing, just from a
// different vendor. English-optimized: non-English sessions skip straight to
// the batch fallback (whisper handles those).
const AAI_RATE = 16000;

// The transcript chain is language-locked: an English session must never
// surface another script, no matter what an engine auto-detects or
// hallucinates (a multilingual default upstream once wrote Devanagari and
// Japanese into real journals). Foreign-script letters are dropped (along
// with CJK/Devanagari punctuation); if no letters survive, the chunk was
// noise and the empty string tells the caller to skip it. Bengali sessions
// keep Bengali + Latin (code-mix is normal speech there).
function keepSessionScript(text, language) {
  if (!text) return "";
  const bn = (language || "en-US").toLowerCase().startsWith("bn");
  let out = "";
  for (const ch of text) {
    if (/[　-〿＀-￯।॥]/.test(ch)) continue; // CJK/fullwidth/danda punctuation
    // Letters AND combining marks: Indic matras/harakat are \p{M}, not \p{L} —
    // testing letters alone leaves orphaned vowel signs behind ("ok ो ो done").
    if (/[\p{L}\p{M}]/u.test(ch) && !(/\p{Script=Latin}/u.test(ch) || (bn && /\p{Script=Bengali}/u.test(ch)))) continue;
    out += ch;
  }
  out = out.replace(/\s{2,}/g, " ").trim();
  return /\p{L}/u.test(out) ? out : "";
}

// Int16 PCM buffer → Float32 [-1,1] (for re-resampling handed-off audio).
function int16ToFloat32(buf) {
  const v = new Int16Array(buf);
  const f = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) f[i] = v[i] / 0x8000;
  return f;
}

// Linear-interpolation resample Float32 [-1,1] → 16k Int16 PCM (AAI's format).
function resampleTo16kPcm(input, fromRate) {
  const ratio = fromRate / AAI_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new ArrayBuffer(outLen * 2);
  const view = new DataView(out);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos), i1 = Math.min(i0 + 1, input.length - 1);
    const s = input[i0] + (input[i1] - input[i0]) * (pos - i0);
    const c = Math.max(-1, Math.min(1, s));
    view.setInt16(i * 2, c < 0 ? c * 0x8000 : c * 0x7fff, true);
  }
  return out;
}

// Wrap accumulated 16-bit mono PCM chunks in a WAV header (one POSTable blob).
function pcmToWav(chunks, sampleRate) {
  let len = 0; for (const c of chunks) len += c.byteLength;
  const buf = new ArrayBuffer(44 + len);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + len, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len, true);
  let off = 44;
  for (const c of chunks) { new Uint8Array(buf, off, c.byteLength).set(new Uint8Array(c)); off += c.byteLength; }
  return new Blob([buf], { type: 'audio/wav' });
}

let sharedMicPromise = null;
async function acquireMic() {
  // Apply the cooperative audio session BEFORE getUserMedia so other apps aren't
  // interrupted and the user's chosen route (AirPods/headset/phone) is honored.
  // Both first-start and the autoResume restart funnel a fresh acquisition
  // through here (restart() → resetSharedMic()).
  await beginVoiceSession();
  return navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS).catch((err) => { sharedMicPromise = null; throw err; });
}

export function getSharedMic() {
  if (!sharedMicPromise) sharedMicPromise = acquireMic();
  // Hand back the cached stream only if it's still LIVE. When iOS suspends the
  // app it revokes the mic, leaving the cached stream's tracks "ended"; reusing
  // it records pure silence (the empty-capture-after-sleep bug). If that
  // happened, drop the dead stream and acquire a fresh one.
  return sharedMicPromise.then((stream) => {
    if (stream.getAudioTracks().some((t) => t.readyState === "live")) return stream;
    try { stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    sharedMicPromise = acquireMic();
    return sharedMicPromise;
  });
}

// Release the shared mic so the NEXT acquisition is fresh. Call when the app
// backgrounds — the OS kills the stream on suspend, and a reused one is dead.
export function resetSharedMic() {
  const p = sharedMicPromise;
  sharedMicPromise = null;
  if (p) p.then((s) => { try { s.getTracks().forEach((t) => t.stop()); } catch { /* noop */ } }).catch(() => {});
}

export function useVoice(onResult, { autoResume = false, keyterms = null, language = "en-US" } = {}) {
  const [listening, setListening] = useState(false);
  const [warming, setWarming] = useState(false);
  const [interim, setInterim] = useState("");
  const [confidence, setConfidence] = useState(null);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const recRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null); // iOS PCM path: the Web Audio context
  const procRef = useRef(null);     // iOS PCM path: ScriptProcessor pulling mic frames
  const srcNodeRef = useRef(null);  // iOS PCM path: MediaStreamSource node
  const keepAliveRef = useRef(null);
  const listeningRef = useRef(false);
  const intendRef = useRef(false);     // does the user want the mic on right now?
  const lastDataRef = useRef(0);       // last time the recorder produced audio (the watchdog's heartbeat)
  const restartingRef = useRef(false); // a self-heal restart is in flight
  const attemptsRef = useRef(0);       // consecutive self-heal attempts without audio
  const keytermsRef = useRef(keyterms); // boost terms for Deepgram (kept current for restarts)
  useEffect(() => { keytermsRef.current = keyterms; }, [keyterms]);
  const languageRef = useRef(language); // STT language (kept current for restarts)
  useEffect(() => { languageRef.current = language; }, [language]);
  const onResultRef = useRef(onResult); // fallback path delivers through the latest callback
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  const fbRef = useRef(null); // batch-fallback session: { ctx, src, proc, pcm[], rate, timer, busy }

  const hasKey = Boolean(DEEPGRAM_KEY);
  // iOS Safari/Chrome (WebKit) ship MediaRecorder but can't emit webm — so we
  // can't gate "supported" on MediaRecorder alone. Web Audio (AudioContext) is
  // the universal fallback for raw-PCM capture and exists on every target,
  // including iOS (under the webkit prefix). So a device is supported if it can
  // grab the mic AND can do EITHER webm recording OR Web Audio.
  const AudioCtxCtor = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;
  const supported = hasKey && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
    && (!!window.MediaRecorder || !!AudioCtxCtor);

  useEffect(() => { listeningRef.current = listening; }, [listening]);

  // Keep the screen awake for the whole live session (warming + listening) so the
  // phone's auto-lock can't kill the mic mid-dictation. Lifts the instant the
  // session ends or the hook unmounts; never overrides a manual lock. The helper
  // re-applies itself on foreground return (the OS drops the hold on background)
  // and is ref-counted, so overlapping hooks are safe. (keepAwake.js)
  useEffect(() => {
    if (!(listening || warming)) return undefined;
    keepScreenAwake();
    return () => allowScreenSleep();
  }, [listening, warming]);

  // Tear down the live pipeline (socket + recorder + keepalive) WITHOUT touching
  // the user's intent or the UI flags — shared by a full stop and a self-heal.
  const teardown = useCallback(() => {
    if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
    if (recRef.current && recRef.current.state !== "inactive") { try { recRef.current.stop(); } catch { /* noop */ } }
    recRef.current = null;
    // Tear down the iOS PCM graph (no-ops on the webm path where these are null).
    if (procRef.current) { try { procRef.current.disconnect(); } catch { /* noop */ } procRef.current.onaudioprocess = null; procRef.current = null; }
    if (srcNodeRef.current) { try { srcNodeRef.current.disconnect(); } catch { /* noop */ } srcNodeRef.current = null; }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch { /* noop */ } audioCtxRef.current = null; }
    if (wsRef.current) {
      const ws = wsRef.current;
      // Detach handlers FIRST: the dying socket's close event must never run a
      // previous session's onclose/onerror against the NEXT session's refs
      // (that stale closure could tear down a fresh pipeline mid-build, or
      // show "Disconnected" right after an intentional stop).
      ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN) {
        // Each vendor has its own goodbye: AAI expects Terminate, Deepgram
        // expects CloseStream — the wrong one just gets ignored, but the
        // session then dies by timeout instead of closing cleanly.
        try { ws.send(JSON.stringify(ws._aai ? { type: "Terminate" } : { type: "CloseStream" })); } catch { /* noop */ }
      }
      try { ws.close(); } catch { /* noop */ }
      wsRef.current = null;
    }
  }, []);

  // Ship one PCM window to the proxy (which runs the multi-provider backup
  // chain) and deliver the transcript like a live final. Shared by the rolling
  // fallback windows AND the one-shot recovery of audio captured before a
  // provider switch — the words spoken during a failover are never dropped.
  const shipWindow = useCallback(async (chunks, rate, deliver = true) => {
    if (!chunks || chunks.length === 0) return null;
    // Energy gate: skip near-silent windows (batch STT invents text on silence).
    let peak = 0;
    for (const c of chunks) {
      const v = new Int16Array(c);
      for (let i = 0; i < v.length; i += 16) { const a = Math.abs(v[i]); if (a > peak) peak = a; }
    }
    if (peak < 700) return null; // ~2% full scale — nobody spoke in this window
    try {
      const wav = pcmToWav(chunks, rate);
      const res = await fetch(`/proxy/deepgram?model=nova-3&smart_format=true&punctuate=true&language=${encodeURIComponent(languageRef.current || "en-US")}`, {
        method: "POST", headers: { "content-type": "audio/wav" }, body: wav,
      });
      if (res.ok) {
        const j = await res.json();
        const alt = j?.results?.channels?.[0]?.alternatives?.[0];
        const txt = (alt?.transcript || "").trim();
        if (txt && deliver) onResultRef.current(txt, { words: [], confidence: null });
        return txt || null;
      }
    } catch { /* this window is lost; the next may get through */ }
    return null;
  }, []);

  // A surface about to SAVE must not lose the words still sitting in the
  // fallback window: it awaits this BEFORE freezing its text — the transcript
  // comes back as the return value instead of through onResult, because by
  // the time a network round-trip finishes the surface has usually unmounted
  // and a late onResult would be dropped. Takes ownership of the pending PCM,
  // so cleanup()'s own flush can't double-deliver it. Resolves fast (null)
  // when there's nothing pending — i.e., on the live-streaming paths.
  const flushPending = useCallback(async () => {
    const fb = fbRef.current;
    if (!fb || fb.pcm.length === 0) return null;
    const chunks = fb.pcm; fb.pcm = [];
    return shipWindow(chunks, fb.rate, false);
  }, [shipWindow]);

  const flushFallback = useCallback(async () => {
    const fb = fbRef.current;
    if (!fb || fb.busy || fb.pcm.length === 0) return;
    const chunks = fb.pcm; fb.pcm = [];
    fb.busy = true;
    await shipWindow(chunks, fb.rate);
    fb.busy = false;
  }, [shipWindow]);

  const exitFallback = useCallback(() => {
    const fb = fbRef.current;
    if (!fb) return;
    fbRef.current = null;
    if (fb.timer) clearInterval(fb.timer);
    if (fb.firstTimer) clearTimeout(fb.firstTimer);
    if (fb.proc) { try { fb.proc.disconnect(); } catch { /* noop */ } fb.proc.onaudioprocess = null; }
    if (fb.src) { try { fb.src.disconnect(); } catch { /* noop */ } }
    if (fb.ctx) { try { fb.ctx.close(); } catch { /* noop */ } }
  }, []);

  // Deepgram's socket is gone but the user still wants the mic: capture PCM via
  // Web Audio (works on every target incl. iOS) and ship windows to the proxy.
  // `handoff` = {chunks, rate} of PCM already captured before the switch — it
  // ships immediately so the words spoken pre-failover still come back.
  const enterFallback = useCallback(async (handoff) => {
    if (fbRef.current || !intendRef.current) return;
    lastDataRef.current = Date.now(); // hold the watchdog off while the graph builds
    try {
      const stream = await getSharedMic();
      streamRef.current = stream;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      try { await ctx.resume(); } catch { /* best-effort */ }
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const fb = { ctx, src, proc, pcm: [], rate: ctx.sampleRate, timer: null, firstTimer: null, busy: false };
      fbRef.current = fb;
      if (handoff?.chunks?.length) shipWindow(handoff.chunks, handoff.rate);
      proc.onaudioprocess = (e) => {
        lastDataRef.current = Date.now(); // keep the self-heal watchdog calm
        attemptsRef.current = 0;
        const input = e.inputBuffer.getChannelData(0);
        const buf = new ArrayBuffer(input.length * 2);
        const view = new DataView(buf);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        fb.pcm.push(buf);
      };
      src.connect(proc);
      proc.connect(ctx.destination); // must be connected to run; writes silence
      // First window ships early so the user sees words within ~4s of speaking,
      // not after a full window; the steady cadence takes over from there.
      fb.firstTimer = setTimeout(() => { flushFallback(); }, 2000);
      fb.timer = setInterval(() => { flushFallback(); }, FB_WINDOW_MS);
      setWarming(false); setListening(true); setError(null); setInterim("");
    } catch {
      setError("Disconnected — check API key");
      intendRef.current = false;
      exitFallback();
      setInterim(""); setWarming(false); setListening(false);
      endVoiceSession();
    }
  }, [flushFallback, exitFallback, shipWindow]);
  const enterFallbackRef = useRef(enterFallback);
  useEffect(() => { enterFallbackRef.current = enterFallback; }, [enterFallback]);

  // Live-streaming backup: AssemblyAI Universal-Streaming over its own socket.
  // Reuses the SAME pipeline refs (wsRef/audioCtxRef/procRef/srcNodeRef) so the
  // existing teardown()/cleanup()/watchdog machinery manages this session too.
  // Returns false when it can't run (no token / non-English) → caller drops to
  // the batch fallback.
  // `handoff` = {chunks, rate} of PCM captured before the switch; it is
  // resampled and queued FIRST so nothing the user said during discovery is
  // lost. The capture graph is built BEFORE the token round-trip for the same
  // reason — the mic records from the first instant, network catches up.
  const enterAAILive = useCallback(async (handoff) => {
    if (!intendRef.current || fbRef.current) return true;
    if (!(languageRef.current || "en-US").toLowerCase().startsWith("en")) return false;
    lastDataRef.current = Date.now(); // hold the watchdog off while we build
    try {
      const stream = await getSharedMic();
      // Tapped off while the mic was being acquired: cleanup() already ran and
      // found nothing — building the graph now would leave a hot mic behind.
      if (!intendRef.current) return true;
      streamRef.current = stream;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      try { await ctx.resume(); } catch { /* best-effort */ }
      let ws = null;
      let open = false;
      const queue = [];
      if (handoff?.chunks?.length) {
        for (const c of handoff.chunks) queue.push(resampleTo16kPcm(int16ToFloat32(c), handoff.rate));
      }
      const source = ctx.createMediaStreamSource(stream);
      srcNodeRef.current = source;
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;
      proc.onaudioprocess = (e) => {
        lastDataRef.current = Date.now(); // watchdog heartbeat
        attemptsRef.current = 0;
        const pcm = resampleTo16kPcm(e.inputBuffer.getChannelData(0), ctx.sampleRate);
        if (open && ws && ws.readyState === WebSocket.OPEN) { try { ws.send(pcm); } catch { /* noop */ } }
        else queue.push(pcm);
      };
      source.connect(proc);
      proc.connect(ctx.destination); // must be connected to run; writes silence

      // Capture is rolling — now do the network part. If AAI can't run, divert
      // to the batch chain WITH everything captured so far (all 16k PCM).
      const aaiFailed = () => {
        if (fbRef.current) return;
        // User stopped mid-switch: the graph built above is live and cleanup()
        // may have run before it existed — dismantle it, don't fall back.
        if (!intendRef.current) { teardown(); return; }
        const carried = { chunks: queue.slice(), rate: AAI_RATE };
        teardown();                        // drop the AAI graph; mic stream survives
        enterFallbackRef.current(carried); // last line of defence: batch via the proxy chain
      };
      let token = null;
      try {
        const res = await fetchWithTimeout("/proxy/aai/token", { method: "POST" }, 5000);
        if (res.ok) token = (await res.json())?.token || null;
      } catch { /* server unreachable — batch may still work via other proxies */ }
      lastDataRef.current = Date.now();
      if (!token || !intendRef.current) { aaiFailed(); return true; }

      // speech_model MUST be the English-only model: the default multilingual
      // model code-switches even under a language_code=en bias (measured — it
      // wrote Hinglish in Devanagari and noise as Japanese into real
      // journals). universal-streaming-english transcribes English, romanizes
      // accents, and stays SILENT on foreign speech. This stream only ever
      // runs for English sessions (the check above).
      ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?sample_rate=${AAI_RATE}&format_turns=true&speech_model=universal-streaming-english&token=${encodeURIComponent(token)}`);
      ws._aai = true; // teardown() sends this vendor's Terminate, not Deepgram's CloseStream
      wsRef.current = ws;
      // A socket that hasn't opened in 5s is dead — fail into batch, don't wait.
      const openDeadline = setTimeout(() => { if (!open) aaiFailed(); }, 5000);
      ws.onopen = () => {
        open = true;
        clearTimeout(openDeadline);
        while (queue.length) { try { ws.send(queue.shift()); } catch { /* noop */ } }
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type !== "Turn") return;
          // Belt over the language_code pin: nothing outside the session's
          // script can reach the journal, whatever the engine sends.
          const txt = keepSessionScript((msg.transcript || "").trim(), languageRef.current);
          if (msg.end_of_turn && msg.turn_is_formatted) {
            if (txt) onResultRef.current(txt, { words: [], confidence: null });
            setInterim("");
          } else if (txt) {
            setInterim(txt);
          }
        } catch { /* noop */ }
      };
      ws.onerror = () => { clearTimeout(openDeadline); aaiFailed(); };
      // ANY close while the user still wants the mic is a failure — AAI ends
      // sessions server-side with a CLEAN code (session lifetime), and ignoring
      // that left a zombie: UI "listening", queue growing, no words ever. A
      // user-initiated stop can't reach here — teardown() detaches handlers.
      ws.onclose = () => { clearTimeout(openDeadline); aaiFailed(); };
      setWarming(false); setListening(true); setError(null); setInterim("");
      return true;
    } catch {
      teardown(); // don't leave a half-built graph capturing into nowhere
      return false;
    }
  }, [teardown]);
  const enterAAILiveRef = useRef(enterAAILive);
  useEffect(() => { enterAAILiveRef.current = enterAAILive; }, [enterAAILive]);

  // Desktop path's pre-switch audio is webm (a container, not PCM) — it can't
  // be fed into the AAI stream, but the proxy's batch chain transcribes it
  // fine. One-shot: recover the words spoken before the socket died.
  const recoverWebm = useCallback(async (blobs) => {
    try {
      const blob = new Blob(blobs, { type: "audio/webm" });
      if (blob.size < 4096) return; // header-only — nothing was said yet
      const res = await fetch(`/proxy/deepgram?model=nova-3&smart_format=true&punctuate=true&language=${encodeURIComponent(languageRef.current || "en-US")}`, {
        method: "POST", headers: { "content-type": "audio/webm" }, body: blob,
      });
      if (res.ok) {
        const j = await res.json();
        const txt = (j?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "").trim();
        if (txt) onResultRef.current(txt, { words: [], confidence: null });
      }
    } catch { /* recovered words lost; the live stream continues */ }
  }, []);

  const cleanup = useCallback(() => {
    teardown();
    // A user-initiated stop should not lose the words already captured in the
    // current fallback window — ship them, then dismantle the fallback graph.
    if (fbRef.current) { flushFallback(); exitFallback(); }
    // Hand the audio session back to other apps (Spotify/YouTube regain full
    // Bluetooth). Only here — NOT in teardown() — so a mid-session autoResume
    // restart doesn't briefly yank and re-grab audio from other apps.
    endVoiceSession();
    setInterim("");
    setWarming(false);
    setListening(false);
  }, [teardown, flushFallback, exitFallback]);

  useEffect(() => () => { intendRef.current = false; cleanup(); streamRef.current = null; }, [cleanup]);

  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    getSharedMic().then((stream) => { if (!cancelled) streamRef.current = stream; }).catch(() => { /* prompt on first click */ });
    return () => { cancelled = true; };
  }, [supported]);

  // Start (or restart) from a clean slate: a fresh, liveness-validated mic and a
  // new Deepgram socket. `warming` stays true while the stream is acquired and
  // the socket opens, so the UI shows a warm-up rather than a dead button.
  const start = useCallback(async () => {
    if (!supported) { setError(hasKey ? "Mic not supported in this browser" : "Add VITE_DEEPGRAM_API_KEY to .env.local"); return; }
    intendRef.current = true;
    lastDataRef.current = Date.now(); // grace window before the watchdog judges the new pipeline dead
    setError(null); setConfidence(null); setInterim("");
    setWarming(true);
    setListening(true);

    try {
      // Deepgram was marked unhealthy moments ago (dead account / outage):
      // don't burn seconds on its doomed handshake — open the AssemblyAI
      // stream directly. Falls through to the normal path if AAI can't run,
      // and Deepgram is re-tried automatically after DG_RETRY_MS.
      if (Date.now() - _dgUnhealthyAt < DG_RETRY_MS) {
        if (await enterAAILiveRef.current()) return;
      }

      // Always go through getSharedMic so a stream the OS killed during a suspend
      // is re-acquired fresh, never reused dead. PCM mode also needs the stream
      // (and its AudioContext sample rate) BEFORE the socket URL is built.
      const stream = await getSharedMic();
      // Tapped off during acquisition (permission prompt, post-suspend
      // re-acquire): cleanup() already ran against an empty pipeline —
      // building the capture graph now would leave the mic hot forever.
      if (!intendRef.current) return;
      streamRef.current = stream;

      // Pick the capture path. webm/opus streams as a self-describing container
      // (Deepgram auto-detects it) and is what desktop + Android use. iOS WebKit
      // can't make webm, so there we capture raw linear16 PCM via Web Audio and
      // declare the encoding + sample rate on the URL.
      const canWebm = !!window.MediaRecorder && (() => {
        try { return MediaRecorder.isTypeSupported("audio/webm;codecs=opus") || MediaRecorder.isTypeSupported("audio/webm"); }
        catch { return false; }
      })();

      const confSamples = [];
      const audioQueue = [];
      let ws = null;
      let wsOpen = false;

      // Keyterm prompting (Nova-3): boost the user's own recurring names so they
      // stop being misheard. Appended per-connection so a mid-session restart
      // keeps the same vocabulary. No terms → the base URL, unchanged.
      let url = withKeyterms(buildDeepgramUrl(languageRef.current), keytermsRef.current);
      let ctx = null;
      if (!canWebm) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = ctx;
        // iOS starts the context "suspended" until a user gesture; start() runs
        // from the mic tap, so resume() is allowed here.
        try { await ctx.resume(); } catch { /* best-effort */ }
        url += `&encoding=linear16&sample_rate=${ctx.sampleRate}&channels=1`;
      }

      // One sender for both paths: heartbeat the watchdog, queue until the
      // socket is open, then stream.
      const sendChunk = (data, hadAudio) => {
        lastDataRef.current = Date.now(); // pipeline is alive — watchdog heartbeat
        attemptsRef.current = 0;          // a healthy pipeline clears the self-heal counter
        if (!hadAudio) return;
        if (ws && wsOpen && ws.readyState === WebSocket.OPEN) { try { ws.send(data); } catch { /* noop */ } }
        else audioQueue.push(data);
      };

      // Capture starts NOW — before any network round-trip — so the first
      // sentence is already in the queue if the handshake goes sideways. The
      // queue drains into the socket once it opens, or rides the handoff into
      // whichever backup takes over.
      if (canWebm) {
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
        const rec = new MediaRecorder(stream, { mimeType: mime });
        recRef.current = rec;
        rec.ondataavailable = (e) => sendChunk(e.data, !!(e.data && e.data.size));
        rec.start(100);
      } else {
        // Web Audio PCM capture (iOS). ScriptProcessor is deprecated but is the
        // only node that works on every iOS version without an AudioWorklet
        // module file. ~4096 frames ≈ 85ms/chunk — a fine watchdog heartbeat.
        const source = ctx.createMediaStreamSource(stream);
        srcNodeRef.current = source;
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        procRef.current = proc;
        proc.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0); // Float32 [-1, 1]
          const buf = new ArrayBuffer(input.length * 2);
          const view = new DataView(buf);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); // 16-bit LE
          }
          sendChunk(buf, true);
        };
        source.connect(proc);
        // The processor must be connected to the destination to run; it writes
        // no output, so this plays silence (no echo).
        proc.connect(ctx.destination);
      }

      // A dying socket fires error THEN close — handle the pair once. If the
      // user still wants the mic, divert to the backups WITH the audio already
      // captured (PCM rides into the live stream; webm is batch-recovered) so
      // the words spoken during discovery still come back.
      let wsFailedOnce = false;
      let openDeadline = null;
      const wsFailed = () => {
        if (wsFailedOnce || fbRef.current) return;
        wsFailedOnce = true;
        if (openDeadline) clearTimeout(openDeadline);
        if (intendRef.current) {
          markDgDown();                     // future starts skip straight to AAI
          lastDataRef.current = Date.now(); // hold the watchdog off during the switch
          const pcmHand = !canWebm && ctx ? { chunks: audioQueue.slice(), rate: ctx.sampleRate } : null;
          const webmHand = canWebm && audioQueue.length ? audioQueue.slice() : null;
          teardown();                        // drop dead socket/recorder; mic stream survives
          if (webmHand) recoverWebm(webmHand);
          // Streaming backup first (AssemblyAI live), batch chain as last resort.
          enterAAILiveRef.current(pcmHand).then((ok) => { if (!ok) enterFallbackRef.current(pcmHand); });
          return;
        }
        setError("Disconnected — check API key");
        cleanup();
      };

      const sessionKey = await getDeepgramKey();
      lastDataRef.current = Date.now();
      // User tapped off mid-warmup: cleanup() may have run BEFORE the capture
      // graph above existed — tear it down explicitly or the mic stays hot.
      if (!intendRef.current) { teardown(); return; }
      // The token endpoint may have JUST learned Deepgram is down — don't burn
      // seconds on its doomed handshake, divert to the streaming backup now.
      if (Date.now() - _dgUnhealthyAt < DG_RETRY_MS) { wsFailed(); return; }

      ws = new WebSocket(url, ["token", sessionKey]);
      wsRef.current = ws;
      // A handshake that hasn't opened in 3.5s is dead — divert, don't wait.
      openDeadline = setTimeout(() => { if (!wsOpen) wsFailed(); }, 3500);

      ws.onopen = () => {
        wsOpen = true;
        clearTimeout(openDeadline);
        markDgUp(); // a live socket is proof of recovery — clear the outage memory
        while (audioQueue.length > 0) { try { ws.send(audioQueue.shift()); } catch { /* noop */ } }
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type !== "Results") return;
          const alt = msg.channel?.alternatives?.[0];
          if (!alt) return;
          // Same output belt as every other engine: the session's script only.
          const txt = keepSessionScript(alt.transcript || "", languageRef.current);
          if (!txt) return;
          if (msg.is_final) {
            // Additive 2nd arg: the per-word array Deepgram returns with each
            // final result, so a consumer can flag the words it was unsure of
            // (voiceConfidence.js). Callers that take only `txt` are unaffected.
            // onResultRef (not the captured prop): a consumer that re-renders
            // mid-session must get finals in its FRESH closure, like the
            // AAI/batch paths already do.
            onResultRef.current(txt, { words: Array.isArray(alt.words) ? alt.words : [], confidence: alt.confidence });
            if (typeof alt.confidence === "number") { confSamples.push(alt.confidence); setConfidence(confSamples.reduce((a, b) => a + b, 0) / confSamples.length); }
            setInterim("");
          } else {
            setInterim(txt);
          }
        } catch { /* noop */ }
      };

      ws.onerror = () => { wsFailed(); };
      ws.onclose = (e) => {
        if (e.code === 1000 || e.code === 1005) {
          if (openDeadline) clearTimeout(openDeadline);
          if (!fbRef.current) cleanup();
          return;
        }
        wsFailed();
      };

      setWarming(false);
      keepAliveRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "KeepAlive" }));
      }, 8000);
    } catch (err) {
      setError(err.name === "NotAllowedError" ? "Mic permission denied" : "Couldn't start mic");
      intendRef.current = false; // don't self-heal a permission/start failure into a loop
      cleanup();
    }
  }, [supported, hasKey, cleanup, teardown, recoverWebm]);

  const startRef = useRef(start);
  useEffect(() => { startRef.current = start; }, [start]);

  // Rebuild the pipeline in place — keeps `listening` true (no flicker to
  // "Paused"), shows the warm-up, drops the dead mic, and starts fresh.
  const restart = useCallback(() => {
    if (restartingRef.current) return;
    restartingRef.current = true;
    attemptsRef.current += 1;
    setWarming(true);
    teardown();
    // A batch-fallback session must be dismantled too — a stale fbRef makes
    // enterAAILive return "already handled" forever, so a restart could never
    // rebuild anything and the watchdog would give up on a recoverable mic.
    if (fbRef.current) { flushFallback(); exitFallback(); }
    resetSharedMic();
    streamRef.current = null;
    lastDataRef.current = Date.now();
    setTimeout(() => { restartingRef.current = false; startRef.current(); }, 140);
  }, [teardown, flushFallback, exitFallback]);

  const toggle = useCallback(() => {
    if (listeningRef.current) { intendRef.current = false; cleanup(); return; }
    attemptsRef.current = 0;
    start();
  }, [start, cleanup]);

  // SELF-HEAL WATCHDOG — the reliable recovery, independent of OS lifecycle
  // events. While the user intends to listen the recorder fires ~every 100ms; if
  // it goes quiet for >3s the mic died. The classic cause: the phone LOCKED and
  // iOS killed the mic WITHOUT firing visibility or appState events, so nothing
  // else notices. We just rebuild it. After a few failed rebuilds we stop
  // gracefully so a genuinely-unavailable mic can't loop.
  useEffect(() => {
    if (!supported || !autoResume) return undefined;
    const id = setInterval(() => {
      if (!intendRef.current || restartingRef.current) return;
      if (Date.now() - lastDataRef.current <= 3000) return;
      if (attemptsRef.current >= 4) {
        intendRef.current = false;
        setError("Couldn't reconnect the mic — tap to try again.");
        cleanup();
        return;
      }
      restart();
    }, 2000);
    return () => clearInterval(id);
  }, [supported, autoResume, cleanup, restart]);

  // Foreground/background hooks make recovery snappier when they DO fire (app
  // switching, web tab visibility): release the mic on background, and on return
  // kick an immediate restart if audio has gone stale. On a screen LOCK these
  // often don't fire at all — the watchdog above is the real safety net.
  useEffect(() => {
    if (!supported) return undefined;
    const onBackground = () => {
      resetSharedMic();
      if (!autoResume) cleanup(); // v1 stops cleanly on background; v2 keeps intent and self-heals on return
    };
    const onForeground = () => {
      if (autoResume && intendRef.current && !restartingRef.current && Date.now() - lastDataRef.current > 1500) restart();
    };
    const onVis = () => { (document.visibilityState === "hidden" ? onBackground : onForeground)(); };
    document.addEventListener("visibilitychange", onVis);
    let appHandle = null;
    import("@capacitor/app")
      .then(({ App }) => App.addListener("appStateChange", ({ isActive }) => { (isActive ? onForeground : onBackground)(); }))
      .then((h) => { appHandle = h; })
      .catch(() => { /* not native — visibilitychange covers web */ });
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (appHandle) { try { appHandle.remove(); } catch { /* noop */ } }
    };
  }, [supported, autoResume, cleanup, restart]);

  return { listening, warming, interim, confidence, supported, error, toggle, flushPending };
}
