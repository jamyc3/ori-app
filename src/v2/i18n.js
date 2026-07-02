// Ori v2 — lightweight bn/en string helper for the reflect-flow + Settings chrome.
//
// `t(en, bn)` returns the English argument VERBATIM in English mode, so English
// rendering — and the eval suites that pin exact English strings — stay
// byte-for-byte unchanged. Bengali is opt-in via the global `ori_reflect_lang`
// pref (the same seam the voice + letter read), so picking বাংলা in Settings
// flips the chrome along with STT and the nightly letter.
//
// This is deliberately NOT a full i18n framework: scope is the reflect flow and
// Settings only (everything else stays English for now). Reads the pref fresh on
// every call so a language switch re-renders into Bengali immediately.
import { REFLECT_LANG_KEY } from '../integrations/deepgram.js';

export function uiLang() {
  try {
    return localStorage.getItem(REFLECT_LANG_KEY) === 'bn' ? 'bn' : 'en';
  } catch {
    return 'en';
  }
}

export function t(en, bn) {
  return uiLang() === 'bn' && bn ? bn : en;
}
