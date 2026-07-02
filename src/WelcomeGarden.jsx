import { useEffect, useRef, useState } from "react";
import { parseTimeToMinutes } from "./sleep-window.js";

// First-run opener. Silent animated intro (figure → inside the mind →
// seed → sprout), then four quiet setup steps: garden name, tending
// mode, reflection time, sleep window. Handoff via onComplete({
// gardenName, mode, reflectTime, sleepWindow }). All CSS is scoped to
// `.wg-*` to avoid collisions with the main dashboard's global sheet.
export default function WelcomeGarden({ onComplete }) {
  const [scene, setScene] = useState("opener");
  const [gardenName, setGardenName] = useState("");
  const [mode, setMode] = useState(null);
  const [reflectTime, setReflectTime] = useState("21:00");
  // Sleep window — kept as HTML time-input strings ("23:00", "07:00") so
  // the pickers work directly. Converted to minutes on handoff. Empty
  // strings = user skipped. Defaults reflect a typical 11pm→7am pattern.
  const [bedTime, setBedTime] = useState("23:00");
  const [wakeTime, setWakeTime] = useState("07:00");

  const openerTimer = useRef(null);
  const nameRef = useRef(null);
  const stageRef = useRef(null);

  // Auto-advance out of the opener. ~10.8s lets the sprout + title + tap
  // cue all land before the scene fades.
  useEffect(() => {
    if (scene !== "opener") return;
    openerTimer.current = setTimeout(() => setScene("name"), 10800);
    return () => { if (openerTimer.current) clearTimeout(openerTimer.current); };
  }, [scene]);

  // Focus the primary input of each step as it becomes active.
  useEffect(() => {
    if (scene === "name") setTimeout(() => nameRef.current?.focus(), 520);
  }, [scene]);

  const skipOpener = () => {
    if (openerTimer.current) clearTimeout(openerTimer.current);
    setScene("name");
  };

  const pickMode = (m) => {
    setMode(m);
    setTimeout(() => setScene("reflect"), 420);
  };

  const finish = (keepReflectTime, keepSleepWindow) => {
    const bedMin = keepSleepWindow ? parseTimeToMinutes(bedTime) : null;
    const wakeMin = keepSleepWindow ? parseTimeToMinutes(wakeTime) : null;
    onComplete?.({
      gardenName: gardenName.trim(),
      mode,
      reflectTime: keepReflectTime ? reflectTime : null,
      sleepWindow: bedMin != null && wakeMin != null
        ? { bedtimeMin: bedMin, wakeMin }
        : null,
    });
  };

  return (
    <div className="wg-stage" ref={stageRef}>
      <style>{WG_CSS}</style>

      {/* ───── OPENER ─────────────────────────────────────────────── */}
      <section className={`wg-scene ${scene === "opener" ? "wg-is-active" : ""}`}>
        <button className="wg-skip-tap" type="button" aria-label="Skip intro" onClick={skipOpener} />
        <div className="wg-scene-inner">
          <div className="wg-opener-canvas">
            <svg className="wg-opener-svg" viewBox="0 0 400 400" aria-hidden="true">
              {/* seated figure */}
              <path className="wg-fig wg-fig-body" d="
                M 200 154
                C 200 172 200 180 200 182
                C 200 190 186 196 172 200
                C 150 208 138 224 136 250
                C 136 268 150 272 172 268
                C 188 266 196 264 200 262
                C 204 264 212 266 228 268
                C 250 272 264 268 264 250
                C 262 224 250 208 228 200
                C 214 196 200 190 200 182
              " />
              <circle className="wg-fig wg-fig-head" cx="200" cy="130" r="24" />

              {/* constellation (inside-the-mind) */}
              <circle className="wg-mind-dot wg-d1" cx="200" cy="200" r="2.2" />
              <circle className="wg-mind-dot wg-d2" cx="170" cy="180" r="1.8" />
              <circle className="wg-mind-dot wg-d3" cx="230" cy="178" r="1.8" />
              <circle className="wg-mind-dot wg-d4" cx="148" cy="218" r="1.6" />
              <circle className="wg-mind-dot wg-d5" cx="252" cy="216" r="1.6" />
              <circle className="wg-mind-dot wg-d6" cx="186" cy="234" r="1.6" />
              <circle className="wg-mind-dot wg-d7" cx="216" cy="236" r="1.6" />

              <path className="wg-mind-link wg-l1" d="M 170 180 L 200 200 L 230 178" />
              <path className="wg-mind-link wg-l2" d="M 148 218 L 200 200 L 252 216" />
              <path className="wg-mind-link wg-l3" d="M 186 234 L 200 200 L 216 236" />
              <path className="wg-mind-link wg-l4" d="M 186 234 L 216 236" />

              {/* seed + sprout */}
              <circle className="wg-seed" cx="200" cy="250" r="4.5" />
              <path className="wg-sprout-stem" d="
                M 200 250
                C 200 234 198 218 200 198
                C 202 186 204 176 203 166
              " />
              <path className="wg-sprout-leaf wg-leaf-left" d="
                M 201 196
                C 188 192 180 188 174 178
              " />
              <path className="wg-sprout-leaf wg-leaf-right" d="
                M 202 182
                C 214 180 222 176 226 166
              " />
            </svg>
          </div>
          <div className="wg-opener-title">A garden for your mind.</div>
          <div className="wg-opener-cue">Tap to continue</div>
        </div>
      </section>

      {/* ───── NAME ─────────────────────────────────────────────────── */}
      <section className={`wg-scene ${scene === "name" ? "wg-is-active" : ""}`}>
        <div className="wg-scene-inner">
          <div className="wg-eyebrow">First</div>
          <h1 className="wg-prompt">Name your garden.</h1>
          <p className="wg-sub">Whatever feels right. Moss. Still Water. A place only you visit.</p>
          <input
            ref={nameRef}
            className="wg-name-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. Moss"
            maxLength={32}
            value={gardenName}
            onChange={(e) => setGardenName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && gardenName.trim().length > 0) {
                e.preventDefault();
                setScene("tend");
              }
            }}
          />
          <div className="wg-btn-row">
            <button
              className="wg-btn-primary"
              type="button"
              disabled={gardenName.trim().length === 0}
              onClick={() => setScene("tend")}
            >Continue</button>
          </div>
          <div className="wg-name-hint">Press return when ready</div>
        </div>
      </section>

      {/* ───── TEND ─────────────────────────────────────────────────── */}
      <section className={`wg-scene ${scene === "tend" ? "wg-is-active" : ""}`}>
        <div className="wg-scene-inner">
          <div className="wg-eyebrow">Then</div>
          <h1 className="wg-prompt">How will you tend it?</h1>
          <p className="wg-sub">You can change this any time.</p>
          <div className="wg-tend-list" role="radiogroup" aria-label="Tending mode">
            {[
              { key: "reflect", title: "Words only", sub: "Just you and the page. Seeds, reflections, readings." },
              { key: "oura",    title: "I wear an Oura ring", sub: "Connect it so readings know your body too." },
              { key: "apple",   title: "Apple Health on my iPhone", sub: "Import what's already been quietly measured." },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={mode === opt.key}
                className={`wg-tend-row ${mode === opt.key ? "wg-is-selected" : ""}`}
                onClick={() => pickMode(opt.key)}
              >
                <div className="wg-tend-row-title">{opt.title}</div>
                <div className="wg-tend-row-sub">{opt.sub}</div>
              </button>
            ))}
          </div>
          <div className="wg-tend-foot">Tap to choose</div>
        </div>
      </section>

      {/* ───── REFLECT ──────────────────────────────────────────────── */}
      <section className={`wg-scene ${scene === "reflect" ? "wg-is-active" : ""}`}>
        <div className="wg-scene-inner">
          <div className="wg-eyebrow">Almost there</div>
          <h1 className="wg-prompt">When does your day wind down?</h1>
          <p className="wg-sub">Your reading lands then — a single honest read of the day.</p>
          <div className="wg-time-wrap">
            <input
              className="wg-time-input"
              type="time"
              value={reflectTime}
              onChange={(e) => setReflectTime(e.target.value)}
            />
          </div>
          <div className="wg-btn-row">
            <button className="wg-btn-primary" type="button" onClick={() => setScene("sleep")}>Continue</button>
            <button className="wg-btn-skip" type="button" onClick={() => { setReflectTime(""); setScene("sleep"); }}>Skip for now</button>
          </div>
        </div>
      </section>

      {/* ───── SLEEP WINDOW ─────────────────────────────────────────── */}
      {/* A soft, skippable ask. When Oura/Apple Health connects later it
          takes over per-night; without device data this is the floor that
          lets Ori still tell the user when their sharpest hours land and
          which weekday tends to be strongest. */}
      <section className={`wg-scene ${scene === "sleep" ? "wg-is-active" : ""}`}>
        <div className="wg-scene-inner">
          <div className="wg-eyebrow">One more, optional</div>
          <h1 className="wg-prompt">When does your sleep land?</h1>
          <p className="wg-sub">A rough window is enough. Helps Ori notice your peak hours and stronger days. Skip if you'd rather not say — you can set it later in Settings.</p>
          <div className="wg-sleep-row">
            <label className="wg-sleep-cell">
              <span className="wg-sleep-label">Bed around</span>
              <input
                className="wg-time-input"
                type="time"
                value={bedTime}
                onChange={(e) => setBedTime(e.target.value)}
              />
            </label>
            <span className="wg-sleep-dash">→</span>
            <label className="wg-sleep-cell">
              <span className="wg-sleep-label">Up around</span>
              <input
                className="wg-time-input"
                type="time"
                value={wakeTime}
                onChange={(e) => setWakeTime(e.target.value)}
              />
            </label>
          </div>
          <div className="wg-btn-row">
            <button className="wg-btn-primary" type="button" onClick={() => setScene("stance")}>Continue</button>
            <button className="wg-btn-skip" type="button" onClick={() => { setBedTime(""); setWakeTime(""); setScene("stance"); }}>Skip for now</button>
          </div>
        </div>
      </section>

      {/* ───── STANCE — how Ori works (non-claims, plain) ────────────── */}
      <section className={`wg-scene ${scene === "stance" ? "wg-is-active" : ""}`}>
        <div className="wg-scene-inner">
          <div className="wg-eyebrow">How Ori works</div>
          <div className="wg-stance-lines">
            <p>Ori reads your day back to you.</p>
            <p>It does not diagnose, advise, or replace a therapist.</p>
            <p>On hard nights, the bottom of every reading shows where to call.</p>
            <p>You decide what to write, when to read, and what to keep.</p>
          </div>
          <div className="wg-btn-row">
            <button className="wg-btn-primary" type="button" onClick={() => setScene("done")}>Begin</button>
          </div>
        </div>
      </section>

      {/* ───── DONE / HANDOFF ───────────────────────────────────────── */}
      <section className={`wg-scene ${scene === "done" ? "wg-is-active" : ""}`}>
        <div className="wg-scene-inner">
          <div className="wg-eyebrow">
            {mode === "reflect" ? "Words only · ready"
              : mode === "oura" ? "Oura · connect next"
              : mode === "apple" ? "Apple Health · import next"
              : "Welcome in"}
          </div>
          <h1 className="wg-done-name">{gardenName.trim() || "Your garden"}</h1>
          <div className="wg-done-sub">a garden for your mind</div>
          <div className="wg-done-cue">
            <button className="wg-btn-primary" type="button" onClick={() => finish(reflectTime !== "", bedTime !== "" && wakeTime !== "")}>
              Enter
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

const WG_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@300;400;500;600&family=Source+Serif+4:wght@300;400;500&family=DM+Mono:wght@300;400;500&display=swap');

.wg-stage {
  --wg-bg: #F7F3EC;
  --wg-ink: #1a1a1a;
  --wg-mt: rgba(26,26,26,.48);
  --wg-ln: rgba(26,26,26,.10);
  --wg-ac: #B8860B;
  --wg-fp: 'Playfair Display', Georgia, serif;
  --wg-fs: 'Source Serif 4', Georgia, serif;
  --wg-fm: 'DM Mono', ui-monospace, monospace;
  --wg-ease: cubic-bezier(.22,.61,.36,1);
  position: fixed;
  inset: 0;
  z-index: 100;
  background: var(--wg-bg);
  color: var(--wg-ink);
  font-family: var(--wg-fs);
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.wg-stage * { box-sizing: border-box; }

.wg-scene {
  position: absolute; inset: 0;
  display: grid;
  place-items: center;
  padding: 60px 24px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition: opacity 1s var(--wg-ease), transform 1s var(--wg-ease);
}
.wg-scene.wg-is-active {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.wg-scene-inner {
  width: 100%;
  max-width: 440px;
  text-align: center;
}

.wg-skip-tap {
  position: absolute; inset: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  z-index: 1;
}
.wg-scene-inner { position: relative; z-index: 2; }

.wg-eyebrow {
  font-family: var(--wg-fm);
  font-size: 9px;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  color: var(--wg-mt);
  margin-bottom: 22px;
}
.wg-prompt {
  font-family: var(--wg-fp);
  font-weight: 300;
  font-size: clamp(28px, 5vw, 40px);
  line-height: 1.15;
  letter-spacing: -0.01em;
  margin: 0 0 12px;
}
.wg-sub {
  font-family: var(--wg-fs);
  font-size: 14px;
  color: var(--wg-mt);
  line-height: 1.55;
  margin: 0;
  font-weight: 400;
}

/* opener */
.wg-opener-canvas {
  position: relative;
  width: min(360px, 80vw);
  aspect-ratio: 1 / 1;
  margin: 0 auto;
}
.wg-opener-svg {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
}
.wg-opener-title {
  margin-top: 12px;
  font-family: var(--wg-fp);
  font-weight: 300;
  font-size: clamp(22px, 3.6vw, 30px);
  letter-spacing: -0.005em;
  opacity: 0;
  animation: wg-fadeUp 1.1s 7.6s var(--wg-ease) forwards;
}
.wg-opener-cue {
  margin-top: 22px;
  font-family: var(--wg-fm);
  font-size: 9px;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  color: var(--wg-mt);
  opacity: 0;
  animation: wg-fadeIn 1s 8.8s var(--wg-ease) forwards, wg-pulseFaint 2.4s 9.8s var(--wg-ease) infinite;
}

.wg-fig {
  stroke: var(--wg-ink);
  fill: none;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.wg-fig-body {
  stroke-dasharray: 420;
  stroke-dashoffset: 420;
  animation: wg-drawPath 1.7s .2s var(--wg-ease) forwards,
             wg-breathe 3.2s 2.0s ease-in-out infinite,
             wg-fadeOutFig 1.2s 3.4s var(--wg-ease) forwards;
  transform-origin: 200px 200px;
}
.wg-fig-head {
  stroke-dasharray: 160;
  stroke-dashoffset: 160;
  animation: wg-drawPath .9s .3s var(--wg-ease) forwards,
             wg-breathe 3.2s 2.0s ease-in-out infinite,
             wg-headZoom 1.6s 3.5s var(--wg-ease) forwards;
  transform-origin: 200px 130px;
}

.wg-mind-dot {
  fill: var(--wg-ink);
  opacity: 0;
  transform-origin: 200px 200px;
}
.wg-mind-dot.wg-d1 { animation: wg-dotIn .6s 4.9s var(--wg-ease) forwards, wg-dotOut 1.1s 7.0s var(--wg-ease) forwards; }
.wg-mind-dot.wg-d2 { animation: wg-dotIn .6s 5.05s var(--wg-ease) forwards, wg-dotOut 1.1s 7.0s var(--wg-ease) forwards; }
.wg-mind-dot.wg-d3 { animation: wg-dotIn .6s 5.2s var(--wg-ease) forwards, wg-dotOut 1.1s 7.0s var(--wg-ease) forwards; }
.wg-mind-dot.wg-d4 { animation: wg-dotIn .6s 5.35s var(--wg-ease) forwards, wg-dotOut 1.1s 7.0s var(--wg-ease) forwards; }
.wg-mind-dot.wg-d5 { animation: wg-dotIn .6s 5.5s var(--wg-ease) forwards, wg-dotOut 1.1s 7.0s var(--wg-ease) forwards; }
.wg-mind-dot.wg-d6 { animation: wg-dotIn .6s 5.65s var(--wg-ease) forwards, wg-dotOut 1.1s 7.0s var(--wg-ease) forwards; }
.wg-mind-dot.wg-d7 { animation: wg-dotIn .6s 5.8s var(--wg-ease) forwards, wg-dotOut 1.1s 7.0s var(--wg-ease) forwards; }

.wg-mind-link {
  stroke: var(--wg-ac);
  stroke-width: 0.6;
  fill: none;
  stroke-dasharray: 120;
  stroke-dashoffset: 120;
  opacity: 0.55;
}
.wg-mind-link.wg-l1 { animation: wg-drawPath .9s 5.8s var(--wg-ease) forwards, wg-linkOut 1.0s 7.0s var(--wg-ease) forwards; }
.wg-mind-link.wg-l2 { animation: wg-drawPath .9s 5.95s var(--wg-ease) forwards, wg-linkOut 1.0s 7.0s var(--wg-ease) forwards; }
.wg-mind-link.wg-l3 { animation: wg-drawPath .9s 6.1s var(--wg-ease) forwards, wg-linkOut 1.0s 7.0s var(--wg-ease) forwards; }
.wg-mind-link.wg-l4 { animation: wg-drawPath .9s 6.25s var(--wg-ease) forwards, wg-linkOut 1.0s 7.0s var(--wg-ease) forwards; }

.wg-seed {
  fill: var(--wg-ink);
  opacity: 0;
  transform-origin: 200px 240px;
  animation: wg-seedIn 1.0s 7.2s var(--wg-ease) forwards;
}
.wg-sprout-stem {
  stroke: var(--wg-ink);
  stroke-width: 1.4;
  fill: none;
  stroke-linecap: round;
  stroke-dasharray: 120;
  stroke-dashoffset: 120;
  animation: wg-drawPath 1.6s 7.6s var(--wg-ease) forwards;
}
.wg-sprout-leaf {
  stroke: var(--wg-ink);
  stroke-width: 1.2;
  fill: none;
  stroke-linecap: round;
  stroke-dasharray: 44;
  stroke-dashoffset: 44;
  opacity: 0.9;
}
.wg-sprout-leaf.wg-leaf-left  { animation: wg-drawPath .9s 8.4s var(--wg-ease) forwards; }
.wg-sprout-leaf.wg-leaf-right { animation: wg-drawPath .9s 8.6s var(--wg-ease) forwards; }

@keyframes wg-drawPath     { to { stroke-dashoffset: 0; } }
@keyframes wg-breathe      { 0%,100% { transform: scale(1); } 50% { transform: scale(1.015); } }
@keyframes wg-fadeOutFig   { from { opacity: 1; } to { opacity: 0; } }
@keyframes wg-headZoom     { from { transform: scale(1); opacity: 1; } to { transform: scale(2.6); opacity: 0; } }
@keyframes wg-dotIn        { from { opacity: 0; transform: scale(.4); } to { opacity: .9; transform: scale(1); } }
@keyframes wg-dotOut       { 0% { opacity: .9; } 40% { opacity: .9; } 100% { opacity: 0; transform: scale(.3); } }
@keyframes wg-linkOut      { to { opacity: 0; } }
@keyframes wg-seedIn       { from { opacity: 0; transform: scale(.5); } to { opacity: 1; transform: scale(1); } }
@keyframes wg-fadeUp       { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes wg-fadeIn       { from { opacity: 0; } to { opacity: 1; } }
@keyframes wg-pulseFaint   { 0%,100% { opacity: .35; } 50% { opacity: 1; } }

/* name */
.wg-name-input {
  display: block;
  width: 100%;
  max-width: 360px;
  margin: 34px auto 0;
  border: none;
  border-bottom: 1px solid var(--wg-ln);
  background: transparent;
  font-family: var(--wg-fp);
  font-weight: 300;
  font-size: clamp(30px, 5vw, 44px);
  text-align: center;
  padding: 14px 0 16px;
  color: var(--wg-ink);
  outline: none;
  transition: border-color .4s var(--wg-ease);
}
.wg-name-input::placeholder { color: rgba(26,26,26,.18); font-style: italic; font-weight: 300; }
.wg-name-input:focus { border-bottom-color: var(--wg-ac); }
.wg-name-hint {
  margin-top: 18px;
  font-family: var(--wg-fm);
  font-size: 9px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--wg-mt);
}

/* tend */
.wg-tend-list {
  margin-top: 34px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
}
.wg-tend-row {
  display: block;
  width: 100%;
  padding: 20px 22px;
  border: 1px solid var(--wg-ln);
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition: border-color .35s var(--wg-ease), background .35s var(--wg-ease), transform .35s var(--wg-ease);
}
@media (hover: hover) {
  .wg-tend-row:hover {
    border-color: rgba(26,26,26,.55);
    background: rgba(26,26,26,.02);
  }
}
.wg-tend-row:focus-visible {
  border-color: rgba(26,26,26,.55);
  background: rgba(26,26,26,.02);
  outline: none;
}
.wg-tend-row:active {
  border-color: rgba(26,26,26,.55);
  background: rgba(26,26,26,.04);
}
.wg-tend-row.wg-is-selected {
  border-color: var(--wg-ink);
  background: rgba(26,26,26,.03);
}
.wg-tend-row-title {
  font-family: var(--wg-fp);
  font-weight: 400;
  font-size: 20px;
  margin-bottom: 4px;
  letter-spacing: -0.005em;
}
.wg-tend-row-sub {
  font-family: var(--wg-fs);
  font-size: 13px;
  color: var(--wg-mt);
  line-height: 1.5;
}
.wg-tend-foot {
  margin-top: 20px;
  font-family: var(--wg-fm);
  font-size: 9px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--wg-mt);
  opacity: .8;
}

/* stance — "how Ori works" non-claims screen */
.wg-stance-lines {
  margin: 34px auto 0;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-align: left;
}
.wg-stance-lines p {
  margin: 0;
  font-family: var(--wg-fp);
  font-weight: 300;
  font-size: clamp(17px, 2.6vw, 21px);
  line-height: 1.42;
  letter-spacing: -0.005em;
  color: var(--wg-ink);
}

/* reflect */
.wg-time-wrap {
  margin-top: 34px;
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  border-bottom: 1px solid var(--wg-ln);
  padding: 10px 18px;
  transition: border-color .4s var(--wg-ease);
}
.wg-time-wrap:focus-within { border-bottom-color: var(--wg-ac); }
.wg-time-input {
  border: none;
  background: transparent;
  font-family: var(--wg-fp);
  font-weight: 300;
  font-size: clamp(44px, 7vw, 60px);
  color: var(--wg-ink);
  text-align: center;
  outline: none;
  min-width: 140px;
}
.wg-time-input::-webkit-calendar-picker-indicator { opacity: .25; cursor: pointer; }

/* sleep window — two compact time cells side-by-side. Each cell gets its
   own small label above the picker so the two times read as a window
   rather than a pair of unrelated inputs. */
.wg-sleep-row {
  margin-top: 34px;
  display: inline-flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  justify-content: center;
}
.wg-sleep-cell {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--wg-ln);
  padding: 6px 14px 8px;
  transition: border-color .4s var(--wg-ease);
}
.wg-sleep-cell:focus-within { border-bottom-color: var(--wg-ac); }
.wg-sleep-cell .wg-time-input {
  font-size: clamp(32px, 5vw, 44px);
  min-width: 110px;
}
.wg-sleep-label {
  font-family: var(--wg-fm);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--wg-mt);
}
.wg-sleep-dash {
  font-family: var(--wg-fp);
  font-weight: 300;
  font-size: 28px;
  color: var(--wg-mt);
  margin-top: 22px;
}

/* buttons */
.wg-btn-row {
  margin-top: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
}
.wg-btn-primary {
  padding: 12px 22px;
  background: var(--wg-ink);
  color: var(--wg-bg);
  border: none;
  border-radius: 999px;
  font-family: var(--wg-fm);
  font-size: 10px;
  letter-spacing: 2.2px;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform .25s var(--wg-ease), background .25s var(--wg-ease);
}
@media (hover: hover) {
  .wg-btn-primary:hover  { transform: translateY(-1px); background: #000; }
}
.wg-btn-primary:active { transform: translateY(0); background: #000; }
.wg-btn-primary:disabled { opacity: .28; cursor: not-allowed; }
.wg-btn-skip {
  background: transparent;
  border: none;
  color: var(--wg-mt);
  font-family: var(--wg-fm);
  font-size: 9px;
  letter-spacing: 2px;
  text-transform: uppercase;
  cursor: pointer;
  padding: 6px 10px;
}
@media (hover: hover) {
  .wg-btn-skip:hover { color: var(--wg-ink); }
}
.wg-btn-skip:active { color: var(--wg-ink); }

/* done */
.wg-done-name {
  font-family: var(--wg-fp);
  font-weight: 300;
  font-size: clamp(44px, 7vw, 64px);
  letter-spacing: -0.015em;
  line-height: 1.08;
  margin: 0;
  opacity: 0;
  animation: wg-fadeUp 1.4s .2s var(--wg-ease) forwards;
}
.wg-done-sub {
  margin-top: 14px;
  font-family: var(--wg-fp);
  font-style: italic;
  font-size: clamp(16px, 2.4vw, 20px);
  color: var(--wg-mt);
  opacity: 0;
  animation: wg-fadeUp 1.4s .9s var(--wg-ease) forwards;
}
.wg-done-cue {
  margin-top: 42px;
  opacity: 0;
  animation: wg-fadeUp 1.4s 1.6s var(--wg-ease) forwards;
}

/* reduced motion */
@media (prefers-reduced-motion: reduce) {
  .wg-fig-body, .wg-fig-head, .wg-mind-dot, .wg-mind-link,
  .wg-opener-title, .wg-opener-cue, .wg-seed, .wg-sprout-stem, .wg-sprout-leaf,
  .wg-done-name, .wg-done-sub, .wg-done-cue {
    animation: none !important;
    opacity: 1 !important;
    stroke-dashoffset: 0 !important;
    transform: none !important;
  }
  .wg-fig-body, .wg-fig-head, .wg-mind-dot, .wg-mind-link { display: none; }
}
`;
