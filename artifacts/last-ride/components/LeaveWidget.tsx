/**
 * Home-screen (small, medium) and lock-screen (rectangular, circular, inline)
 * widgets: tonight's leave time and a live countdown. Premium.
 *
 * Like the Live Activity, the 'widget' function runs in WidgetKit's runtime:
 * it may only use its props and Expo UI SwiftUI components, so colours are
 * declared inside it. lib/widgets.ts builds the timeline (lib/widgetContent.ts).
 */
import { AccessoryWidgetBackground, HStack, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  containerBackground,
  font,
  foregroundStyle,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { LeaveWidgetProps } from "@/lib/widgetContent";

const LeaveWidget = (props: LeaveWidgetProps, environment: WidgetEnvironment) => {
  "widget";
  const navy = "#0A1322";
  const amber = "#F5A93B";
  const mist = "#8FA2B8";
  const white = "#EAF0F7";
  const family = environment.widgetFamily;
  const lockScreen = family === "accessoryRectangular" || family === "accessoryCircular" || family === "accessoryInline";
  const range = { lower: new Date(props.shownAt), upper: new Date(props.countdownTo) };
  const open = widgetURL("last-ride://ride");

  if (props.kind === "message") {
    if (family === "accessoryInline") return <Text modifiers={[open]}>{props.message}</Text>;
    if (lockScreen)
      return (
        <VStack alignment="leading" spacing={2} modifiers={[open]}>
          <Text modifiers={[font({ weight: "semibold", size: 13 }), lineLimit(1)]}>{props.heading}</Text>
          <Text modifiers={[font({ size: 12 }), lineLimit(2)]}>{props.message}</Text>
        </VStack>
      );
    return (
      <VStack alignment="leading" spacing={6} modifiers={[containerBackground(navy, "widget"), open]}>
        <Text modifiers={[font({ weight: "bold", size: 13 }), foregroundStyle(amber)]}>{props.heading}</Text>
        <Text modifiers={[font({ size: 14 }), foregroundStyle(white), lineLimit(4)]}>{props.message}</Text>
        <Spacer />
      </VStack>
    );
  }

  if (family === "accessoryInline") return <Text modifiers={[open]}>{props.inline}</Text>;

  if (family === "accessoryCircular")
    return (
      <ZStack modifiers={[open]}>
        <AccessoryWidgetBackground />
        <Text
          timerInterval={range}
          countsDown
          modifiers={[font({ weight: "bold", design: "rounded", size: 15 }), monospacedDigit(), minimumScaleFactor(0.6), padding({ horizontal: 4 })]}
        />
      </ZStack>
    );

  if (family === "accessoryRectangular")
    return (
      <VStack alignment="leading" spacing={1} modifiers={[open]}>
        <Text modifiers={[font({ weight: "semibold", size: 13 }), lineLimit(1)]}>{props.heading}</Text>
        <Text modifiers={[font({ weight: "bold", size: 15 }), lineLimit(1)]}>{props.inline}</Text>
        <Text timerInterval={range} countsDown modifiers={[font({ size: 13 }), monospacedDigit()]} />
      </VStack>
    );

  if (family === "systemMedium")
    return (
      <HStack spacing={12} modifiers={[containerBackground(navy, "widget"), open]}>
        <VStack alignment="leading" spacing={4}>
          <Text modifiers={[font({ weight: "bold", size: 12 }), foregroundStyle(amber), lineLimit(1)]}>{props.heading}</Text>
          <Text modifiers={[font({ weight: "bold", design: "rounded", size: 40 }), monospacedDigit(), foregroundStyle(white)]}>
            {props.bigTime}
          </Text>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(mist), lineLimit(2)]}>{props.detail}</Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={4}>
          <Text modifiers={[font({ size: 11 }), foregroundStyle(mist)]}>{props.countdownLabel}</Text>
          <Text
            timerInterval={range}
            countsDown
            modifiers={[font({ weight: "bold", design: "rounded", size: 24 }), monospacedDigit(), foregroundStyle(amber)]}
          />
          <Text modifiers={[font({ size: 11 }), foregroundStyle(mist), lineLimit(1)]}>{props.arrival}</Text>
        </VStack>
      </HStack>
    );

  // systemSmall
  return (
    <VStack alignment="leading" spacing={4} modifiers={[containerBackground(navy, "widget"), open]}>
      <Text modifiers={[font({ weight: "bold", size: 12 }), foregroundStyle(amber), lineLimit(1)]}>{props.short}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 11 }), foregroundStyle(mist)]}>{props.countdownLabel}</Text>
      <Text
        timerInterval={range}
        countsDown
        modifiers={[font({ weight: "bold", design: "rounded", size: 30 }), monospacedDigit(), foregroundStyle(white), minimumScaleFactor(0.6)]}
      />
      <Text modifiers={[font({ size: 12 }), foregroundStyle(mist), lineLimit(1)]}>{props.footer}</Text>
    </VStack>
  );
};

export default createWidget("LeaveWidget", LeaveWidget);
