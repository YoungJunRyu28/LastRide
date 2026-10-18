/**
 * The iOS Live Activity shown during night-out tracking: the countdown and the
 * timeline rail (leave → chosen train → 終電) on the lock screen, and in the
 * Dynamic Island the label left of the camera, the countdown right of it.
 *
 * The 'widget' function runs in WidgetKit's own runtime, not the app's: it can
 * only use its props and Expo UI SwiftUI components, so the colours (the chosen
 * theme) come in the props. lib/liveActivity.ts decides what it shows and when.
 */
import { Ellipse, HStack, Image, ProgressView, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  activityBackgroundTint,
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  progressViewStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";
import type { LiveActivityContent } from "@/lib/liveActivityContent";

export type LeaveCountdownProps = LiveActivityContent & {
  /** Epoch ms when this content was shown; the timer runs from here to countdownTo. */
  shownAt: number;
};

const LeaveCountdown = (props: LeaveCountdownProps, _environment: LiveActivityEnvironment) => {
  "widget";
  const c = props.colors;
  // The Dynamic Island is always black: white themes use the default colours there.
  const ic = c.dark ? c : { ...c, background: "#000000", text: "#ffffff", muted: "#c9d4de", faint: "#5f708a", leave: "#f5a93b", train: "#b9adff" };
  const toneColor = props.tone === "train" ? c.train : c.leave;
  const islandTone = props.tone === "train" ? ic.train : ic.leave;
  const range = { lower: new Date(props.shownAt), upper: new Date(props.countdownTo) };

  const stopColor = (p: typeof c, index: number) => {
    const stop = props.stops[index];
    if (stop.state === "done") return p.faint;
    if (stop.state === "later") return p.muted;
    return index === 0 ? p.leave : p.train;
  };
  const dot = (p: typeof c, index: number) => {
    if (props.stops[index].state === "later")
      return (
        <ZStack modifiers={[frame({ width: 12, height: 12 })]}>
          <Ellipse modifiers={[foregroundStyle(p.muted), frame({ width: 12, height: 12 })]} />
          <Ellipse modifiers={[foregroundStyle(p.background), frame({ width: 8, height: 8 })]} />
        </ZStack>
      );
    return <Ellipse modifiers={[foregroundStyle(stopColor(p, index)), frame({ width: 12, height: 12 })]} />;
  };
  const bar = (p: typeof c, index: number) => {
    const entry = props.bars[index];
    const modifiers = [progressViewStyle("linear"), tint(p.muted), labelsHidden()];
    return entry.state === "live" ? (
      <ProgressView timerInterval={{ lower: new Date(entry.from), upper: new Date(entry.to) }} countsDown={false} modifiers={modifiers} />
    ) : (
      <ProgressView value={entry.state === "full" ? 1 : 0} modifiers={modifiers} />
    );
  };
  // Each stop is a fixed column (dot, name, time) centred on its dot, so the
  // last label sits inside the edge instead of running off it; the bars
  // between stops stretch to fill the width.
  const rail = (p: typeof c) => (
    <HStack alignment="top" spacing={0}>
      {props.stops.map((stop, index) => [
        <VStack key={`bar-${index}`} modifiers={[padding({ top: 4 }), frame({ maxWidth: 1000 })]}>
          {bar(p, index)}
        </VStack>,
        <VStack key={`stop-${index}`} alignment="center" spacing={2} modifiers={[frame({ width: 54 })]}>
          {dot(p, index)}
          <Text modifiers={[font({ weight: "bold", size: 10 }), foregroundStyle(stopColor(p, index)), lineLimit(1), minimumScaleFactor(0.7)]}>{stop.label}</Text>
          <Text modifiers={[font({ weight: "heavy", design: "rounded", size: 10 }), monospacedDigit(), foregroundStyle(stopColor(p, index)), lineLimit(1), minimumScaleFactor(0.7)]}>{stop.time}</Text>
        </VStack>,
      ])}
    </HStack>
  );
  const timer = (size: number, color: string) => (
    <Text
      timerInterval={range}
      countsDown
      modifiers={[font({ weight: "heavy", design: "rounded", size }), monospacedDigit(), foregroundStyle(color), lineLimit(1), minimumScaleFactor(0.6)]}
    />
  );

  return {
    banner: (
      <VStack alignment="leading" spacing={10} modifiers={[padding({ all: 16 }), activityBackgroundTint(c.background)]}>
        <HStack alignment="top">
          <VStack alignment="leading" spacing={1}>
            <Text modifiers={[font({ weight: "bold", size: 12 }), foregroundStyle(toneColor), lineLimit(1)]}>{props.label}</Text>
            {timer(34, toneColor)}
          </VStack>
          <Spacer />
          <VStack alignment="trailing" spacing={2}>
            <Text modifiers={[font({ weight: "bold", size: 13 }), foregroundStyle(c.text), lineLimit(1), minimumScaleFactor(0.7)]}>{props.from}</Text>
            <Text modifiers={[font({ size: 11 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.choice}</Text>
            {/* How fresh the times are; with app-only tracking, that they need the app. */}
            <Text modifiers={[font({ size: 11 }), foregroundStyle(c.muted), lineLimit(1), minimumScaleFactor(0.8)]}>{props.checked}</Text>
          </VStack>
        </HStack>
        {rail(c)}
      </VStack>
    ),
    // A's shape: the label left of the camera, the countdown right of it, both
    // kept off the island's rounded ends. The countdown can run to hours while
    // tracking, so its box fits "0:00:00" and it shrinks rather than cutting.
    compactLeading: (
      <Text modifiers={[font({ weight: "bold", size: 12 }), foregroundStyle(islandTone), lineLimit(1), minimumScaleFactor(0.7), padding({ leading: 6 })]}>{props.island}</Text>
    ),
    compactTrailing: (
      <Text
        timerInterval={range}
        countsDown
        modifiers={[
          font({ weight: "bold", design: "rounded", size: 14 }),
          monospacedDigit(),
          foregroundStyle(islandTone),
          lineLimit(1),
          minimumScaleFactor(0.6),
          multilineTextAlignment("trailing"),
          frame({ minWidth: 44, maxWidth: 66, alignment: "trailing" }),
          padding({ trailing: 6 }),
        ]}
      />
    ),
    minimal: <Image systemName="tram.fill" modifiers={[foregroundStyle(islandTone)]} />,
    expandedLeading: (
      <Text modifiers={[font({ weight: "bold", size: 13 }), foregroundStyle(islandTone), lineLimit(1), minimumScaleFactor(0.7), padding({ leading: 8 })]}>{props.label}</Text>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={2} modifiers={[padding({ trailing: 8 })]}>
        <Text modifiers={[font({ weight: "bold", size: 13 }), lineLimit(1), minimumScaleFactor(0.7)]}>{props.from}</Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(ic.muted), lineLimit(1), minimumScaleFactor(0.8)]}>{props.choice}</Text>
      </VStack>
    ),
    // The countdown gets the full width here, above the rail, instead of a corner.
    expandedBottom: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ horizontal: 8, bottom: 4 })]}>
        <Text
          timerInterval={range}
          countsDown
          modifiers={[font({ weight: "heavy", design: "rounded", size: 32 }), monospacedDigit(), foregroundStyle(islandTone), lineLimit(1), minimumScaleFactor(0.6)]}
        />
        {rail(ic)}
      </VStack>
    ),
  };
};

export default createLiveActivity("LeaveCountdown", LeaveCountdown);
