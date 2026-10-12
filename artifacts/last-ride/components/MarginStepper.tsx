/**
 * 早めに出る時間 (余裕): minutes to leave before the latest time, by the minute,
 * with quick picks. Used in Settings and in setup.
 */
import { Chip } from '@/components/ui';
import { DIGITS } from '@/constants/type';
import { useColors } from '@/hooks/useColors';
import { MAX_LEAVE_MARGIN_MINUTES, type LeaveMargin } from '@/lib/reliability';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const PRESETS = [0, 3, 5, 10, 15];

export function MarginStepper({
  value,
  onChange,
  ja,
}: {
  value: LeaveMargin;
  onChange: (minutes: LeaveMargin) => void;
  ja: boolean;
}) {
  const colors = useColors();
  const button = (delta: number, symbol: string, testID: string, label: string, disabled: boolean) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(value + delta)}
      style={({ pressed }) => [
        styles.stepButton,
        { backgroundColor: colors.secondary, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.stepText, { color: colors.foreground }]}>{symbol}</Text>
    </Pressable>
  );
  return (
    <View>
      <View style={styles.stepper}>
        {button(-1, '−', 'margin-minus', ja ? '1分減らす' : 'One minute less', value <= 0)}
        <View style={styles.value} accessible accessibilityLabel={ja ? `${value}分` : `${value} minutes`}>
          <Text style={[styles.minutes, { color: colors.primary }]}>{value}</Text>
          <Text style={[styles.unit, { color: colors.foreground }]}>{ja ? '分' : 'min'}</Text>
        </View>
        {button(1, '＋', 'margin-plus', ja ? '1分増やす' : 'One minute more', value >= MAX_LEAVE_MARGIN_MINUTES)}
      </View>
      <View style={styles.presets}>
        {PRESETS.map((minutes) => (
          <Chip
            key={minutes}
            testID={`margin-${minutes}`}
            label={ja ? `${minutes}分` : `${minutes} min`}
            selected={value === minutes}
            onPress={() => onChange(minutes)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 18 },
  stepButton: { alignItems: 'center', borderRadius: 28, height: 56, justifyContent: 'center', width: 56 },
  stepText: { fontSize: 28, fontWeight: '700' },
  value: { alignItems: 'baseline', flexDirection: 'row', gap: 4 },
  minutes: { fontFamily: DIGITS, fontSize: 56, lineHeight: 62 },
  unit: { fontSize: 18, fontWeight: '800' },
  presets: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 16 },
});
