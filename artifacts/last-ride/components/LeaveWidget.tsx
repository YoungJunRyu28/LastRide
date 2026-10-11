/**
 * Home-screen (small, medium) and lock-screen (rectangular, circular, inline)
 * widgets: tonight's leave time, then a live countdown for the last hour with
 * a bar that drains like the app's ring. Premium.
 *
 * Like the Live Activity, the 'widget' function runs in WidgetKit's runtime:
 * it may only use its props and Expo UI SwiftUI components, so colours are
 * declared inside it. lib/widgets.ts builds the timeline (lib/widgetContent.ts).
 */
import { AccessoryWidgetBackground, HStack, Image, ProgressView, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  labelsHidden,
  progressViewStyle,
  tint,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { LeaveWidgetProps } from "@/lib/widgetContent";

const LeaveWidget = (props: LeaveWidgetProps, environment: WidgetEnvironment) => {
  "widget";
  const navy = "#0A1322";
  const amber = "#F5A93B";
  const mist = "#8FA2B8";
  const subtle = "#C9D4DE";
  const white = "#EAF0F7";
  const family = environment.widgetFamily;
  const lockScreen = family === "accessoryRectangular" || family === "accessoryCircular" || family === "accessoryInline";
  const countdown = { lower: new Date(props.shownAt), upper: new Date(props.countdownTo) };
  // The bar is full until the last hour, then drains to leave-by (or the last train).
  const bar = { lower: new Date(Math.max(props.barFrom, props.shownAt)), upper: new Date(props.countdownTo) };
  const open = widgetURL("last-ride://ride");
  const counting = props.phase === "countdown";

  if (props.kind === "message") {
    if (family === "accessoryInline") return <Text modifiers={[open]}>{props.message}</Text>;
    if (lockScreen)
      return (
        <VStack alignment="leading" spacing={2} modifiers={[open]}>
          <HStack spacing={4}>
            <Image systemName="tram.fill" size={11} />
            <Text modifiers={[font({ weight: "semibold", size: 13 }), lineLimit(1)]}>{props.heading}</Text>
          </HStack>
          <Text modifiers={[font({ size: 12 }), lineLimit(2)]}>{props.message}</Text>
        </VStack>
      );
    return (
      <VStack alignment="leading" spacing={8} modifiers={[containerBackground(navy, "widget"), open]}>
        <HStack spacing={5}>
          <Image systemName="tram.fill" size={12} color={amber} />
          <Text modifiers={[font({ weight: "bold", size: 13 }), foregroundStyle(amber)]}>{props.heading}</Text>
        </HStack>
        <Spacer />
        <Text modifiers={[font({ weight: "semibold", size: 14 }), foregroundStyle(white), lineLimit(4)]}>{props.message}</Text>
      </VStack>
    );
  }

  if (family === "accessoryInline")
    return (
      <HStack spacing={4} modifiers={[open]}>
        <Image systemName="tram.fill" />
        <Text>{props.inline}</Text>
      </HStack>
    );

  if (family === "accessoryCircular")
    return (
      <ZStack modifiers={[open]}>
        <AccessoryWidgetBackground />
        <ProgressView timerInterval={bar} countsDown modifiers={[progressViewStyle("circular")]}>
          <VStack spacing={0}>
            <Image systemName="tram.fill" size={10} />
            <Text modifiers={[font({ weight: "bold", design: "rounded", size: 12 }), monospacedDigit(), minimumScaleFactor(0.7)]}>
              {props.bigTime}
            </Text>
          </VStack>
        </ProgressView>
      </ZStack>
    );

  if (family === "accessoryRectangular")
    return (
      <VStack alignment="leading" spacing={2} modifiers={[open]}>
        <HStack spacing={4}>
          <Image systemName="tram.fill" size={11} />
          <Text modifiers={[font({ weight: "semibold", size: 12 }), lineLimit(1)]}>{props.short}</Text>
          <Spacer />
          {counting ? (
            <Text timerInterval={countdown} countsDown modifiers={[font({ weight: "bold", size: 12 }), monospacedDigit(), frame({ maxWidth: 64 })]} />
          ) : null}
        </HStack>
        <Text modifiers={[font({ weight: "bold", size: 16 }), lineLimit(1), minimumScaleFactor(0.8)]}>{props.inline}</Text>
        <ProgressView timerInterval={bar} countsDown modifiers={[progressViewStyle("linear"), labelsHidden()]} />
      </VStack>
    );

  // The big number: the leave time while there's plenty of time, then the live countdown.
  const bigNumber = (size: number) =>
    counting ? (
      <Text
        timerInterval={countdown}
        countsDown
        modifiers={[font({ weight: "bold", design: "rounded", size }), monospacedDigit(), foregroundStyle(amber), minimumScaleFactor(0.6), lineLimit(1)]}
      />
    ) : (
      <Text modifiers={[font({ weight: "bold", design: "rounded", size }), monospacedDigit(), foregroundStyle(amber), minimumScaleFactor(0.6), lineLimit(1)]}>
        {props.bigTime}
      </Text>
    );
  const drainingBar = (
    <ProgressView timerInterval={bar} countsDown modifiers={[progressViewStyle("linear"), tint(amber), labelsHidden()]} />
  );

  if (family === "systemMedium")
    return (
      <HStack spacing={16} modifiers={[containerBackground(navy, "widget"), open]}>
        <VStack alignment="leading" spacing={4}>
          <HStack spacing={5}>
            <Image systemName="tram.fill" size={12} color={amber} />
            <Text modifiers={[font({ weight: "bold", size: 12 }), foregroundStyle(amber), lineLimit(1)]}>{props.heading}</Text>
          </HStack>
          <Spacer />
          <Text modifiers={[font({ weight: "semibold", size: 11 }), foregroundStyle(mist)]}>{props.bigLabel}</Text>
          {bigNumber(48)}
          {drainingBar}
        </VStack>
        <VStack alignment="leading" spacing={6}>
          <Spacer />
          <VStack alignment="leading" spacing={1}>
            <Text modifiers={[font({ weight: "bold", size: 15 }), foregroundStyle(white), lineLimit(1)]}>{props.from}</Text>
            <Text modifiers={[font({ weight: "semibold", size: 12 }), foregroundStyle(subtle), lineLimit(2)]}>{props.detail}</Text>
          </VStack>
          {props.arrival ? (
            <HStack spacing={4}>
              <Image systemName="house.fill" size={10} color={mist} />
              <Text modifiers={[font({ size: 12 }), foregroundStyle(mist), lineLimit(1)]}>{props.arrival}</Text>
            </HStack>
          ) : null}
        </VStack>
      </HStack>
    );

  // systemSmall
  return (
    <VStack alignment="leading" spacing={4} modifiers={[containerBackground(navy, "widget"), open]}>
      <HStack spacing={5}>
        <Image systemName="tram.fill" size={12} color={amber} />
        <Text modifiers={[font({ weight: "bold", size: 12 }), foregroundStyle(amber), lineLimit(1)]}>{props.short}</Text>
      </HStack>
      <Spacer />
      <Text modifiers={[font({ weight: "semibold", size: 11 }), foregroundStyle(mist)]}>{props.bigLabel}</Text>
      {bigNumber(42)}
      {drainingBar}
      <Text modifiers={[font({ weight: "semibold", size: 11 }), foregroundStyle(subtle), lineLimit(1), padding({ top: 2 })]}>{props.footer}</Text>
    </VStack>
  );
};

export default createWidget("LeaveWidget", LeaveWidget);
