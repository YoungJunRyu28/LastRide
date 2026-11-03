/**
 * Telling users about a change to the terms or privacy policy inside the app
 * (terms §10, 民法548条の4: a change that's worse for users must be announced
 * before it takes effect). A notice goes in TERMS_NOTICES and ships by OTA; the
 * home screen shows it once, as a card, until it's opened or closed.
 *
 * A fresh install has just agreed to the current terms on the welcome screen,
 * so it starts with every notice so far counted as seen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

export type TermsNotice = {
  /** Increases with each notice; never reused. */
  version: number;
  /** When the change takes effect (shown on the card), e.g. "2026-12-01". */
  effectiveFrom: string;
  /** Which page changed: the terms or the privacy policy. */
  page: 'terms' | 'privacy';
  ja: { title: string; body: string };
  en: { title: string; body: string };
};

/**
 * Newest last. Add one here (and announce it on the page) for any change
 * that's worse for users, at least 2–4 weeks before `effectiveFrom`.
 * Example:
 *   { version: 1, effectiveFrom: '2026-12-01', page: 'terms',
 *     ja: { title: '利用規約を改定します（12月1日から）', body: '第○条の…を変更します。' },
 *     en: { title: 'Our terms change on 1 December', body: 'Section … changes …' } },
 */
export const TERMS_NOTICES: TermsNotice[] = [];

/** Shown for this long after the change takes effect, then no longer. */
const SHOW_AFTER_EFFECT_MS = 30 * 24 * 60 * 60 * 1000;
const SEEN_KEY = 'lastride-terms-notice-seen';

const latestVersion = () => TERMS_NOTICES.reduce((max, notice) => Math.max(max, notice.version), 0);

/** The notice to show now, if any: the newest one not yet seen and not long past. */
export function pendingNotice(seenVersion: number, nowMs = Date.now()): TermsNotice | null {
  const unseen = TERMS_NOTICES.filter(
    (notice) =>
      notice.version > seenVersion &&
      nowMs < Date.parse(`${notice.effectiveFrom}T00:00:00+09:00`) + SHOW_AFTER_EFFECT_MS,
  );
  return unseen.length > 0 ? unseen[unseen.length - 1] : null;
}

/** Call once setup is done (the welcome screen's agreement): later notices only. */
export async function markTermsCurrent(): Promise<void> {
  await AsyncStorage.setItem(SEEN_KEY, String(latestVersion())).catch(() => undefined);
}

/** React: the notice to show on the home screen, and a way to mark it seen. */
export function useTermsNotice(): { notice: TermsNotice | null; dismiss: () => void } {
  const [notice, setNotice] = useState<TermsNotice | null>(null);
  useEffect(() => {
    if (TERMS_NOTICES.length === 0) return;
    let live = true;
    void AsyncStorage.getItem(SEEN_KEY)
      .then(async (raw) => {
        // Never stored: an install from before notices existed agreed to the terms
        // as they were then, so it does see a notice published since.
        const seen = raw === null ? 0 : Number(raw) || 0;
        if (live) setNotice(pendingNotice(seen));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const dismiss = useCallback(() => {
    if (!notice) return;
    setNotice(null);
    void AsyncStorage.setItem(SEEN_KEY, String(notice.version)).catch(() => undefined);
  }, [notice]);
  return { notice, dismiss };
}
