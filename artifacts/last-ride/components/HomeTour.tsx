/**
 * The home screen tour: short popups pointing at the leave time, the circle
 * (案内を開始 / countdown) and the train / station chips.
 * - First open of the home screen, once loaded: shown whatever is on screen;
 *   anything not there (after the last train, near home) is explained mid-screen.
 * - If that first time had no leave time ahead, once more the first time one shows.
 * - Settings › 使い方をもう一度見る: straight away, whatever is on screen.
 */
import { useColors } from '@/hooks/useColors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

const TOUR_KEY = 'lastride-home-tour-done';

/**
 * - first: never shown; shown on the next home screen, whatever its state
 * - waiting: shown without a leave time ahead; shown again over the first one
 * - replay: asked for in Settings; shown straight away
 * - done: nothing more
 */
export type TourStage = 'first' | 'waiting' | 'replay' | 'done';

const stageOf = (value: string | null): TourStage =>
  value === null ? 'first' : value === 'waiting' || value === 'replay' ? value : 'done';

/** Shows the tour again as soon as the home screen is back. */
export function resetHomeTour() {
  return AsyncStorage.setItem(TOUR_KEY, 'replay').catch(() => undefined);
}

/** Where the tour is up to; re-read whenever the home screen comes back into view. */
export function useHomeTour() {
  const [stage, setStage] = useState<TourStage>('done');
  useFocusEffect(
    useCallback(() => {
      let live = true;
      AsyncStorage.getItem(TOUR_KEY)
        .then((value) => live && setStage(stageOf(value)))
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }, []),
  );
  /** `withLeaveTime`: a leave time ahead was on screen, so it was the whole tour. */
  const finish = (withLeaveTime: boolean) => {
    const next: TourStage = withLeaveTime || stage !== 'first' ? 'done' : 'waiting';
    setStage(next);
    void AsyncStorage.setItem(TOUR_KEY, next === 'done' ? 'true' : next).catch(() => undefined);
  };
  return { stage, finish };
}

export type TourStep = {
  key: string;
  /** The element pointed at; when it isn't on screen the step is skipped, or shown mid-screen with `explainMissing`. */
  target: React.RefObject<View | null>;
  title: string;
  body: string;
};

type Box = { x: number; y: number; width: number; height: number };

const PAD = 8;

export function HomeTour({
  steps,
  ja,
  onDone,
  explainMissing = false,
}: {
  steps: TourStep[];
  ja: boolean;
  onDone: () => void;
  explainMissing?: boolean;
}) {
  const colors = useColors();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  // 'centre': the item isn't on screen, so the bubble sits mid-screen with nothing highlighted.
  const [box, setBox] = useState<Box | 'centre' | null>(null);
  const step = steps[index];
  const stepKey = step?.key;

  useEffect(() => {
    if (!step) return;
    setBox(null);
    // A moment for the screen to settle before measuring where things are.
    const timer = setTimeout(() => {
      const missing = () => (explainMissing ? setBox('centre') : setIndex((value) => value + 1));
      const node = step.target.current;
      if (!node) {
        missing();
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (!width || !height) missing();
        else setBox({ x: x - PAD, y: y - PAD, width: width + PAD * 2, height: height + PAD * 2 });
      });
    }, 250);
    return () => clearTimeout(timer);
    // The parent re-renders every second (the countdown): only a new step re-measures.
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (index >= steps.length) onDone();
  }, [index, steps.length, onDone]);

  if (!step) return null;
  const last = index === steps.length - 1;
  const next = () => (last ? onDone() : setIndex(index + 1));
  const dim = 'rgba(0, 0, 0, 0.72)';
  // The bubble goes under the highlighted item when there's room, otherwise above it.
  const area = box && box !== 'centre' ? box : null;
  const below = area ? area.y + area.height + 210 < screenH : true;
  const bubbleWidth = Math.min(screenW - 32, 360);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onDone}>
      <Pressable style={StyleSheet.absoluteFill} onPress={next} accessibilityRole="button" accessibilityLabel={ja ? '次へ' : 'Next'}>
        {area ? (
          <>
            <View style={[styles.dim, { backgroundColor: dim, left: 0, right: 0, top: 0, height: Math.max(0, area.y) }]} />
            <View style={[styles.dim, { backgroundColor: dim, left: 0, right: 0, top: area.y + area.height, bottom: 0 }]} />
            <View style={[styles.dim, { backgroundColor: dim, left: 0, width: Math.max(0, area.x), top: area.y, height: area.height }]} />
            <View style={[styles.dim, { backgroundColor: dim, left: area.x + area.width, right: 0, top: area.y, height: area.height }]} />
            <View style={[styles.ring, { borderColor: colors.primary, left: area.x, top: area.y, width: area.width, height: area.height }]} />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: dim }]} />
        )}
      </Pressable>

      {box && (
        <View
          style={[
            styles.bubble,
            { backgroundColor: colors.card, borderColor: colors.primary, width: bubbleWidth, left: (screenW - bubbleWidth) / 2 },
            !area ? { top: screenH * 0.36 } : below ? { top: area.y + area.height + 12 } : { bottom: screenH - area.y + 12 },
          ]}
        >
          <Text style={[styles.count, { color: colors.primary }]}>{index + 1} / {steps.length}</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>{step.title}</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>{step.body}</Text>
          <View style={styles.buttons}>
            {!last ? (
              <Pressable testID="tour-skip" onPress={onDone} accessibilityRole="button" hitSlop={8}>
                <Text style={[styles.skip, { color: colors.mutedForeground }]}>{ja ? 'スキップ' : 'Skip'}</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable
              testID="tour-next"
              onPress={next}
              accessibilityRole="button"
              style={({ pressed }) => [styles.next, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.nextText, { color: colors.primaryForeground }]}>
                {last ? (ja ? 'はじめる' : 'Got it') : ja ? '次へ' : 'Next'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute' },
  ring: { borderRadius: 18, borderWidth: 2, position: 'absolute' },
  bubble: { borderRadius: 18, borderWidth: 1, gap: 6, padding: 16, position: 'absolute' },
  count: { fontSize: 12, fontWeight: '800' },
  title: { fontSize: 17, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20 },
  buttons: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  skip: { fontSize: 14, fontWeight: '700' },
  next: { borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
  nextText: { fontSize: 14, fontWeight: '800' },
});
