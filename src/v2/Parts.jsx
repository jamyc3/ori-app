// Ori v2 — All-Parts list.
//
// Renders all 8 parts Ori names, sorted by familiarity (Constant → Newcomer)
// with recently-thanked parts sinking to the back so the next un-sat-with
// part surfaces (matching v1 commit 3911cc6 behavior; sortPartsForList in
// part-history.js owns the logic).
//
// Reachable from Settings → Parts you've met, and from the Letter's
// parts-peek ribbon. Tapping a row opens Per-Part detail.

import { useMemo } from 'react';
import './styles/parts.css';
import {
  sortPartsForList, loadThanks, statsFor,
  STAGE_NEWCOMER, STAGE_REGULAR, STAGE_FREQUENT, STAGE_CONSTANT,
} from '../part-history.js';
import { PARTS_LIB, partLabel } from '../LetterReading.jsx';
import { reflectSttLanguage } from '../integrations/deepgram.js';
import { t } from './i18n.js';
import { CrisisHelpFooter } from './CrisisSupport.jsx';

const STAGE_LABEL = {
  [STAGE_NEWCOMER]: 'Newcomer',
  [STAGE_REGULAR]:  'Regular',
  [STAGE_FREQUENT]: 'Frequent',
  [STAGE_CONSTANT]: 'Constant',
  stranger:         'Not yet seen',
};
const STAGE_LABEL_BN = {
  [STAGE_NEWCOMER]: 'নতুন',
  [STAGE_REGULAR]:  'নিয়মিত',
  [STAGE_FREQUENT]: 'প্রায়ই',
  [STAGE_CONSTANT]: 'সবসময়',
  stranger:         'এখনও দেখা হয়নি',
};

function loadHistory() {
  try {
    const raw = localStorage.getItem('cpi-v2-data');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed?.history || []);
  } catch {
    return [];
  }
}

function IconChevronRight() {
  return (
    <svg width="8" height="13" viewBox="0 0 8 13" aria-hidden="true">
      <path d="M1 1 L7 6.5 L1 12" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}

export default function Parts({ onOpenPart, onBack }) {
  const lang = reflectSttLanguage();
  const rows = useMemo(() => {
    const history = loadHistory();
    const thanks = loadThanks();
    const sorted = sortPartsForList(history, Object.values(PARTS_LIB), thanks);
    return sorted.map((p) => ({ part: p, stats: statsFor(history, p, thanks) }));
  }, []);

  return (
    <section className="v2-parts">
      {onBack && (
        <button type="button" className="v2-backrow" onClick={onBack} aria-label={t('Back', 'পিছনে')}>
          <IconChevronLeft />
          <span>{t('Back', 'পিছনে')}</span>
        </button>
      )}
      <div className="v2-parts-eyebrow">{t("Parts you've met", 'যাদের সঙ্গে দেখা হয়েছে')}</div>
      <h1 className="v2-parts-title">{t('The eight figures Ori names', 'অরি যে আটজনকে নাম দেয়')}</h1>
      <p className="v2-parts-lead">
        {t("Each part shows up in your letters under different conditions. Tap one to read what it's holding for you and respond the way that part needs.", 'প্রতিটি অংশ আলাদা সময়ে তোমার চিঠিতে আসে। একটাতে চাপো — দেখো সে তোমার জন্য কী ধরে রেখেছে, আর তার যেমন দরকার তেমন সাড়া দাও।')}
      </p>
      <p className="v2-parts-lead">
        {t("These are names for patterns in what you've written — not parts of who you are. Keep the ones that fit; let the rest go.", 'এগুলো তোমার লেখায় ফুটে ওঠা ধরনের নাম — তুমি ঠিক কে, তা নয়। যেগুলো মেলে, রেখে দাও; বাকিগুলো ছেড়ে দাও।')}
      </p>

      <div className="v2-parts-list">
        {rows.map(({ part, stats }) => {
          const stage = lang === 'bn'
            ? (STAGE_LABEL_BN[stats?.stage] || 'এখনও দেখা হয়নি')
            : (STAGE_LABEL[stats?.stage] || 'Not yet seen');
          const visits = stats?.visits || 0;
          const fillPct = Math.max(2, Math.min(100, (stats?.familiarityFraction || 0) * 100));
          return (
            <button
              key={part.id}
              type="button"
              className="v2-prow"
              onClick={() => onOpenPart?.(part.id)}
            >
              <span
                className="v2-prow-glyph"
                style={{ color: part.color || 'var(--forest)', borderColor: `${part.color || 'var(--forest)'}40` }}
                aria-hidden="true"
              >
                {part.glyph || '◯'}
              </span>
              <div className="v2-prow-mid">
                <div className="v2-prow-name-row">
                  <span className="v2-prow-name">{partLabel(part, lang)}</span>
                  <span className="v2-prow-stage">{stage}</span>
                </div>
                <div className="v2-prow-sub">
                  {visits === 0
                    ? t("Hasn't appeared in your letters yet.", 'এখনও তোমার চিঠিতে আসেনি।')
                    : (lang === 'bn' ? `${visits} বার` : `${visits} visit${visits === 1 ? '' : 's'}`)}
                </div>
                <div className="v2-prow-bar">
                  <i style={{ width: `${fillPct}%`, background: part.color || 'var(--forest)' }} />
                </div>
              </div>
              <span className="v2-prow-chev"><IconChevronRight /></span>
            </button>
          );
        })}
      </div>

      <p className="v2-parts-foot">
        {t("Order: by familiarity; recently-acknowledged parts sink toward the back so the next one you haven't sat with surfaces. One-tap gestures stay on this device; a written reflection is sent to the model only with your okay.", 'ক্রম: পরিচয়ের মাপে; সদ্য সাড়া-দেওয়া অংশগুলো পিছিয়ে যায়, যাতে যেটার সঙ্গে এখনও বসোনি সেটা সামনে আসে। এক-চাপের অঙ্গভঙ্গি এই ডিভাইসেই থাকে; লেখা প্রতিফলন শুধু তোমার সম্মতিতে মডেলে যায়।')}
      </p>

      <CrisisHelpFooter />
    </section>
  );
}
