/**
 * The iOS Live Activity shown during night-out tracking: the leave-by
 * countdown on the lock screen and in the Dynamic Island.
 *
 * The 'widget' function runs in WidgetKit's own runtime, not the app's: it can
 * only use its props and Expo UI SwiftUI components, so colours are declared
 * inside it. lib/liveActivity.ts decides what it shows and when.
 */
import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  activityBackgroundTint,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

export type LeaveCountdownProps = {
  title: string;
  subtitle: string;
  /** Epoch ms: when this content was shown, and the moment the timer counts down to. */
  shownAt: number;
  countdownTo: number;
};

const LeaveCountdown = (
  props: LeaveCountdownProps,
  _environment: LiveActivityEnvironment,
) => {
  "widget";
  const navy = "#112238";
  const amber = "#F2A33A";
  const mist = "#C9D4DE";
  const range = {
    lower: new Date(props.shownAt),
    upper: new Date(props.countdownTo),
  };

  return {
    banner: (
      <HStack
        spacing={12}
        modifiers={[padding({ all: 16 }), activityBackgroundTint(navy)]}
      >
        <VStack alignment="leading" spacing={4}>
          <Text
            modifiers={[
              font({ weight: "semibold", size: 17 }),
              foregroundStyle("#FFFFFF"),
              lineLimit(1),
            ]}
          >
            {props.title}
          </Text>
          <Text
            modifiers={[
              font({ size: 13 }),
              foregroundStyle(mist),
              lineLimit(2),
            ]}
          >
            {props.subtitle}
          </Text>
        </VStack>
        <Spacer />
        <Text
          timerInterval={range}
          countsDown
          modifiers={[
            font({ weight: "bold", design: "rounded", size: 28 }),
            monospacedDigit(),
            foregroundStyle(amber),
          ]}
        />
      </HStack>
    ),
    compactLeading: (
      <Image systemName="tram.fill" modifiers={[foregroundStyle(amber)]} />
    ),
    compactTrailing: (
      <Text
        timerInterval={range}
        countsDown
        modifiers={[
          monospacedDigit(),
          foregroundStyle(amber),
          frame({ maxWidth: 56 }),
        ]}
      />
    ),
    minimal: (
      <Image systemName="tram.fill" modifiers={[foregroundStyle(amber)]} />
    ),
    expandedLeading: (
      <Image
        systemName="tram.fill"
        modifiers={[foregroundStyle(amber), padding({ leading: 4 })]}
      />
    ),
    expandedTrailing: (
      <Text
        timerInterval={range}
        countsDown
        modifiers={[
          font({ weight: "bold", design: "rounded", size: 22 }),
          monospacedDigit(),
          foregroundStyle(amber),
        ]}
      />
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={2}>
        <Text
          modifiers={[font({ weight: "semibold", size: 16 }), lineLimit(1)]}
        >
          {props.title}
        </Text>
        <Text
          modifiers={[font({ size: 13 }), foregroundStyle(mist), lineLimit(2)]}
        >
          {props.subtitle}
        </Text>
      </VStack>
    ),
  };
};

export default createLiveActivity("LeaveCountdown", LeaveCountdown);
