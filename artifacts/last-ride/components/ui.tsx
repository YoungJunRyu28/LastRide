/**
 * Design 3 building blocks: the dark night UI with amber accents. Screens
 * compose these so spacing, radii and touch targets stay consistent.
 */
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { DIGITS } from '@/constants/type';
import { useColors } from '@/hooks/useColors';

type IconName = React.ComponentProps<typeof Feather>['name'];

/** 44pt round icon button (back, gear, more, close). */
export function IconButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: colors.card, borderColor: colors.input, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Feather name={icon} size={19} color={colors.foreground} />
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  testID,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  icon?: IconName;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: colors.primary, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryForeground} />
      ) : (
        <>
          <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>{label}</Text>
          {icon && <Feather name={icon} size={18} color={colors.primaryForeground} />}
        </>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  testID,
  tone = 'default',
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  tone?: 'default' | 'accent';
}) {
  const colors = useColors();
  const color = tone === 'accent' ? colors.primary : colors.foreground;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.secondaryButton,
        { borderColor: tone === 'accent' ? colors.primary : colors.input, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Text style={[styles.secondaryText, { color }]}>{label}</Text>
    </Pressable>
  );
}

/** Quiet text-only action ("あとで", "キャンセル"). */
export function TextButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.textButtonText, { color: colors.mutedForeground }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({
  children,
  style,
  highlighted,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  highlighted?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: highlighted ? colors.primary : colors.border,
          borderWidth: highlighted ? 2 : 1,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider() {
  const colors = useColors();
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{children}</Text>;
}

/** Toggle chip, e.g. "15分前". */
export function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.secondary }]}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={[
          styles.chipText,
          { color: selected ? colors.primaryForeground : colors.mutedForeground, fontWeight: selected ? '900' : '700' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  stretch,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  stretch?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.background }, stretch && { alignSelf: 'stretch' }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={`choose-${option.value}`}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[styles.segment, stretch && { flex: 1 }, { backgroundColor: selected ? colors.primary : 'transparent' }]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.segmentText,
                { color: selected ? colors.primaryForeground : colors.mutedForeground, fontWeight: selected ? '900' : '700' },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A row with title, optional subtitle, and either a switch, a chevron or custom content. */
export function Row({
  title,
  subtitle,
  onPress,
  switchValue,
  onSwitch,
  destructive,
  children,
  testID,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  switchValue?: boolean;
  onSwitch?: (value: boolean) => void;
  destructive?: boolean;
  children?: React.ReactNode;
  testID?: string;
}) {
  const colors = useColors();
  const titleColor = destructive ? colors.destructive : colors.foreground;
  const body = (
    <>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: titleColor }]}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
      </View>
      {onSwitch ? (
        <Switch
          testID={testID}
          accessibilityLabel={title}
          value={!!switchValue}
          onValueChange={onSwitch}
          trackColor={{ false: colors.input, true: colors.primary }}
          thumbColor={colors.background}
          // react-native-web colours the "on" thumb separately.
          {...({ activeThumbColor: colors.background } as object)}
        />
      ) : (
        children ?? (onPress ? <Feather name="chevron-right" size={18} color={colors.mutedForeground} /> : null)
      )}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

export function PremiumTag({ label = 'プレミアム', solid }: { label?: string; solid?: boolean }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.premiumTag,
        solid
          ? { backgroundColor: colors.primary, borderColor: colors.primary }
          : { borderColor: colors.primary },
      ]}
    >
      <Feather name="star" size={11} color={solid ? colors.primaryForeground : colors.primary} />
      <Text style={[styles.premiumText, { color: solid ? colors.primaryForeground : colors.primary }]}>{label}</Text>
    </View>
  );
}

/** Countdown ring: `fraction` of the evening still left before leave-by (0–1). */
export function CountdownRing({
  fraction,
  label,
  value,
  size = 124,
  tone = 'primary',
}: {
  fraction: number;
  label: string;
  value: string;
  size?: number;
  tone?: 'primary' | 'destructive' | 'muted';
}) {
  const colors = useColors();
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction));
  const color = tone === 'destructive' ? colors.destructive : tone === 'muted' ? colors.mutedForeground : colors.primary;
  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={`${label} ${value}`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.secondary} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.ringCenter]}>
        <Text style={[styles.ringLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          adjustsFontSizeToFit
          // Words ("発車済み", "Now") use the text face, smaller; times use the digit face.
          style={[styles.ringValue, !/\d/.test(value) && styles.ringWord, { color: colors.foreground }]}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
  },
  primaryText: { fontSize: 16, fontWeight: '900' },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 18,
  },
  secondaryText: { fontSize: 15, fontWeight: '700' },
  textButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  textButtonText: { fontSize: 15, fontWeight: '700' },
  card: { borderRadius: 20, overflow: 'hidden' },
  sectionLabel: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  chip: {
    alignItems: 'center',
    borderRadius: 999,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 8,
  },
  chipText: { fontSize: 13 },
  segmented: { borderRadius: 12, flexDirection: 'row', padding: 3 },
  segment: { alignItems: 'center', borderRadius: 10, justifyContent: 'center', minHeight: 34, paddingHorizontal: 10 },
  segmentText: { fontSize: 13 },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowSubtitle: { fontSize: 12, lineHeight: 17 },
  premiumTag: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  premiumText: { fontSize: 11, fontWeight: '900' },
  ringCenter: { alignItems: 'center', justifyContent: 'center' },
  ringLabel: { fontSize: 11, fontWeight: '700' },
  ringValue: { fontFamily: DIGITS, fontSize: 28, lineHeight: 32 },
  ringWord: { fontFamily: undefined, fontSize: 18, fontWeight: '800' },
});
