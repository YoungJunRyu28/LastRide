/**
 * Home-screen (small, medium) and lock-screen (rectangular, circular, inline)
 * widgets. Premium. Four states (lib/widgetContent.ts): the live timeline
 * (leave → chosen train → 終電) with the countdown; tonight's train time when
 * not tracking; the first train once the last has gone; a short message.
 *
 * Like the Live Activity, the 'widget' function runs in WidgetKit's runtime:
 * it may only use its props and Expo UI SwiftUI components, so everything it
 * shows, colours included (the chosen theme), comes in the props.
 */
import { AccessoryWidgetBackground, Ellipse, HStack, Image, ProgressView, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  progressViewStyle,
  tint,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { LeaveWidgetProps } from "@/lib/widgetContent";

const LeaveWidget = (props: LeaveWidgetProps, environment: WidgetEnvironment) => {
  "widget";
  const c = props.colors;
  const family = environment.widgetFamily;
  const open = widgetURL("last-ride://ride");
  const background = containerBackground(c.background, "widget");
  const toneColor = props.tone === "train" ? c.train : c.leave;
  const countdown = { lower: new Date(props.shownAt), upper: new Date(props.countdownTo) };
  const liveBar = props.bars.find((bar) => bar.state === "live");
  const icon = props.icon === "moon" ? "moon.fill" : props.icon === "alert" ? "exclamationmark.circle" : "tram.fill";
  const iconColor = props.icon === "alert" ? c.alert : c.leave;

  // A stop's colour: the one being counted to in its accent, passed ones faint.
  const stopColor = (index: number) => {
    const stop = props.stops[index];
    if (stop.state === "done") return c.faint;
    if (stop.state === "later") return c.muted;
    return index === 0 ? c.leave : c.train;
  };
  const dot = (index: number, size: number) => {
    const state = props.stops[index].state;
    if (state === "later")
      return (
        <ZStack modifiers={[frame({ width: size, height: size })]}>
          <Ellipse modifiers={[foregroundStyle(c.muted), frame({ width: size, height: size })]} />
          <Ellipse modifiers={[foregroundStyle(c.background), frame({ width: size - 4, height: size - 4 })]} />
        </ZStack>
      );
    return <Ellipse modifiers={[foregroundStyle(stopColor(index)), frame({ width: size, height: size })]} />;
  };
  const bar = (index: number) => {
    const entry = props.bars[index];
    const modifiers = [progressViewStyle("linear"), tint(c.muted), labelsHidden()];
    return entry.state === "live" ? (
      <ProgressView timerInterval={{ lower: new Date(entry.from), upper: new Date(entry.to) }} countsDown={false} modifiers={modifiers} />
    ) : (
      <ProgressView value={entry.state === "full" ? 1 : 0} modifiers={modifiers} />
    );
  };
  const timer = (size: number, color: string) => (
    <Text
      timerInterval={countdown}
      countsDown
      modifiers={[font({ weight: "heavy", design: "rounded", size }), monospacedDigit(), foregroundStyle(color), minimumScaleFactor(0.6), lineLimit(1)]}
    />
  );

  // ── Lock screen (tinted by iOS; no own colours) ──
  if (family === "accessoryInline")
    return (
      <HStack spacing={4} modifiers={[open]}>
        <Image systemName={props.kind === "message" ? icon : "tram.fill"} />
        <Text>{props.inline}</Text>
      </HStack>
    );

  if (family === "accessoryCircular")
    return (
      <ZStack modifiers={[open]}>
        <AccessoryWidgetBackground />
        {props.kind === "live" && liveBar ? (
          <ProgressView timerInterval={{ lower: new Date(liveBar.from), upper: new Date(liveBar.to) }} countsDown modifiers={[progressViewStyle("circular")]}>
            <VStack spacing={0}>
              <Image systemName="tram.fill" size={10} />
              <Text modifiers={[font({ weight: "bold", design: "rounded", size: 12 }), monospacedDigit(), minimumScaleFactor(0.7)]}>{props.countdownTime}</Text>
            </VStack>
          </ProgressView>
        ) : props.kind === "plan" || props.kind === "first" ? (
          <VStack spacing={0}>
            <Image systemName="tram.fill" size={10} />
            <Text modifiers={[font({ weight: "bold", design: "rounded", size: 13 }), monospacedDigit(), minimumScaleFactor(0.7)]}>{props.trainTime}</Text>
          </VStack>
        ) : (
          <Image systemName={icon} size={22} />
        )}
      </ZStack>
    );

  if (family === "accessoryRectangular") {
    if (props.kind === "live")
      return (
        <VStack alignment="leading" spacing={2} modifiers={[open]}>
          <HStack spacing={4}>
            <Image systemName="tram.fill" size={11} />
            <Text modifiers={[font({ weight: "semibold", size: 12 }), lineLimit(1)]}>{props.label}</Text>
            <Spacer />
            <Text timerInterval={countdown} countsDown modifiers={[font({ weight: "bold", size: 13 }), monospacedDigit(), frame({ maxWidth: 64 })]} />
          </HStack>
          <Text modifiers={[font({ weight: "bold", size: 15 }), lineLimit(1), minimumScaleFactor(0.8)]}>{props.inline}</Text>
          {liveBar ? (
            <ProgressView timerInterval={{ lower: new Date(liveBar.from), upper: new Date(liveBar.to) }} countsDown modifiers={[progressViewStyle("linear"), labelsHidden()]} />
          ) : null}
        </VStack>
      );
    if (props.kind === "plan" || props.kind === "first")
      return (
        <VStack alignment="leading" spacing={1} modifiers={[open]}>
          <HStack spacing={4}>
            <Image systemName="tram.fill" size={11} />
            <Text modifiers={[font({ weight: "semibold", size: 12 }), lineLimit(1)]}>{props.kind === "first" ? props.title : props.trainHeading}</Text>
          </HStack>
          <Text modifiers={[font({ weight: "bold", design: "rounded", size: 20 }), monospacedDigit(), lineLimit(1)]}>
            {props.kind === "first" ? `${props.trainTime}` : `${props.trainTime} ${props.trainSuffix}`}
          </Text>
          <Text modifiers={[font({ size: 11 }), lineLimit(1), minimumScaleFactor(0.8)]}>
            {props.kind === "first" ? props.trainHeading : `${props.leaveLine} · ${props.checked}`}
          </Text>
        </VStack>
      );
    return (
      <VStack alignment="leading" spacing={2} modifiers={[open]}>
        <HStack spacing={4}>
          <Image systemName={icon} size={11} />
          <Text modifiers={[font({ weight: "semibold", size: 13 }), lineLimit(1)]}>{props.heading}</Text>
        </HStack>
        <Text modifiers={[font({ size: 12 }), lineLimit(2)]}>{props.message}</Text>
      </VStack>
    );
  }

  const medium = family === "systemMedium";

  // ── Message: next day, no route, not set up ──
  if (props.kind === "message") {
    if (medium)
      return (
        <HStack spacing={16} modifiers={[background, open]}>
          <Image systemName={icon} size={40} color={iconColor} />
          <VStack alignment="leading" spacing={4}>
            <Text modifiers={[font({ weight: "bold", size: 11 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.heading}</Text>
            <Text modifiers={[font({ weight: "bold", size: 17 }), foregroundStyle(c.text), lineLimit(3)]}>{props.message}</Text>
            {props.hint ? <Text modifiers={[font({ size: 12 }), foregroundStyle(c.muted), lineLimit(2)]}>{props.hint}</Text> : null}
          </VStack>
          <Spacer />
        </HStack>
      );
    return (
      <VStack alignment="leading" spacing={6} modifiers={[background, open]}>
        <Text modifiers={[font({ weight: "bold", size: 11 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.heading}</Text>
        <Spacer />
        <Image systemName={icon} size={30} color={iconColor} />
        <Spacer />
        <Text modifiers={[font({ weight: "bold", size: 13 }), foregroundStyle(c.text), lineLimit(3)]}>{props.message}</Text>
        {props.hint ? <Text modifiers={[font({ size: 11 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.hint}</Text> : null}
      </VStack>
    );
  }

  // ── First train: the last has gone ──
  if (props.kind === "first") {
    const body = (timeSize: number) => (
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ weight: "bold", size: 11 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.trainHeading}</Text>
        <Text modifiers={[font({ weight: "heavy", design: "rounded", size: timeSize }), monospacedDigit(), foregroundStyle(c.text)]}>{props.trainTime}</Text>
        {props.arrival ? <Text modifiers={[font({ size: 11 }), foregroundStyle(c.faint), lineLimit(1)]}>{props.arrival}</Text> : null}
      </VStack>
    );
    if (medium)
      return (
        <HStack alignment="top" spacing={12} modifiers={[background, open]}>
          <VStack alignment="leading" spacing={8}>
            <Text modifiers={[font({ weight: "bold", size: 13 }), foregroundStyle(c.alert)]}>{props.title}</Text>
            {body(44)}
            <Spacer />
          </VStack>
          <Spacer />
          <VStack alignment="trailing" spacing={4}>
            <Text modifiers={[font({ size: 12 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.to}</Text>
            <Spacer />
            <Text modifiers={[font({ weight: "bold", size: 12 }), foregroundStyle(c.leave)]}>{props.link}</Text>
          </VStack>
        </HStack>
      );
    return (
      <VStack alignment="leading" spacing={10} modifiers={[background, open]}>
        <Spacer />
        <Text modifiers={[font({ weight: "bold", size: 12 }), foregroundStyle(c.alert), lineLimit(1)]}>{props.title}</Text>
        {body(34)}
        <Text modifiers={[font({ weight: "bold", size: 11 }), foregroundStyle(c.leave)]}>{props.link}</Text>
        <Spacer />
      </VStack>
    );
  }

  // ── Not tracking: tonight's train time leads ──
  if (props.kind === "plan") {
    const trainTime = (size: number) => (
      <HStack alignment="lastTextBaseline" spacing={3}>
        <Text modifiers={[font({ weight: "heavy", design: "rounded", size }), monospacedDigit(), foregroundStyle(c.text), minimumScaleFactor(0.7), lineLimit(1)]}>{props.trainTime}</Text>
        <Text modifiers={[font({ weight: "bold", size: size * 0.38 }), foregroundStyle(c.text)]}>{props.trainSuffix}</Text>
      </HStack>
    );
    if (medium)
      return (
        <VStack alignment="leading" spacing={0} modifiers={[background, open]}>
          <HStack>
            <Text modifiers={[font({ weight: "bold", size: 11 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.heading}</Text>
            <Spacer />
            <Text modifiers={[font({ size: 11 }), foregroundStyle(c.muted)]}>{props.checked}</Text>
          </HStack>
          <Spacer />
          <HStack alignment="bottom">
            <VStack alignment="leading" spacing={0}>
              <Text modifiers={[font({ weight: "bold", size: 12 }), foregroundStyle(c.train), lineLimit(1)]}>{props.trainHeading}</Text>
              {trainTime(46)}
            </VStack>
            <Spacer />
            <VStack alignment="trailing" spacing={3}>
              <Text modifiers={[font({ size: 12 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.leaveLine}</Text>
              {props.arrival ? <Text modifiers={[font({ size: 12 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.arrival}</Text> : null}
            </VStack>
          </HStack>
          <Spacer />
          <Text modifiers={[font({ size: 11 }), foregroundStyle(c.faint), lineLimit(1), minimumScaleFactor(0.8)]}>{props.footnote}</Text>
        </VStack>
      );
    return (
      <VStack alignment="leading" spacing={4} modifiers={[background, open]}>
        <Text modifiers={[font({ weight: "bold", size: 11 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.to}</Text>
        <Spacer />
        <Text modifiers={[font({ weight: "bold", size: 12 }), foregroundStyle(c.train), lineLimit(1), minimumScaleFactor(0.8)]}>{props.trainHeading}</Text>
        {trainTime(36)}
        <Spacer />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(c.muted), lineLimit(1)]}>{props.leaveLine}</Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(c.faint), lineLimit(1)]}>{props.checked}</Text>
      </VStack>
    );
  }

  // ── Live: countdown and the timeline ──
  if (medium)
    return (
      <VStack alignment="leading" spacing={0} modifiers={[background, open]}>
        <HStack alignment="top">
          <VStack alignment="leading" spacing={0}>
            <Text modifiers={[font({ weight: "bold", size: 14 }), foregroundStyle(toneColor), lineLimit(1)]}>{props.label}</Text>
            {timer(54, toneColor)}
          </VStack>
          <Spacer />
          <VStack alignment="trailing" spacing={2}>
            <Text modifiers={[font({ weight: "black", size: 16 }), foregroundStyle(c.text), lineLimit(1), minimumScaleFactor(0.7)]}>{props.from}</Text>
            <Text modifiers={[font({ size: 12 }), foregroundStyle(c.muted), lineLimit(1), minimumScaleFactor(0.7)]}>{props.to}</Text>
            {props.arrival ? (
              <Text modifiers={[font({ weight: "bold", design: "rounded", size: 14 }), monospacedDigit(), foregroundStyle(c.muted)]}>{props.arrival}</Text>
            ) : null}
          </VStack>
        </HStack>
        <Spacer />
        {/* The rail: equal columns, each a bar into its stop, the label ending at the dot. */}
        <HStack spacing={0}>
          {props.stops.map((stop, index) => (
            <VStack key={index} alignment="trailing" spacing={3} modifiers={[frame({ maxWidth: 1000 })]}>
              <HStack spacing={0}>
                {bar(index)}
                {dot(index, 13)}
              </HStack>
              <Text modifiers={[font({ weight: "bold", size: 11 }), foregroundStyle(stopColor(index)), lineLimit(1), minimumScaleFactor(0.7)]}>{stop.short}</Text>
            </VStack>
          ))}
        </HStack>
      </VStack>
    );

  // systemSmall: centred, the count, then the stops as a list.
  return (
    <VStack alignment="leading" spacing={9} modifiers={[background, open]}>
      <Spacer />
      <VStack alignment="leading" spacing={0}>
        <Text modifiers={[font({ weight: "bold", size: 11 }), foregroundStyle(toneColor), lineLimit(1), minimumScaleFactor(0.8)]}>{props.label}</Text>
        {timer(34, toneColor)}
      </VStack>
      <VStack alignment="leading" spacing={5}>
        {props.stops.map((stop, index) => (
          <HStack key={index} spacing={7}>
            {dot(index, 9)}
            <Text modifiers={[font({ weight: "heavy", design: "rounded", size: 12 }), monospacedDigit(), foregroundStyle(stopColor(index)), frame({ width: 40, alignment: "leading" })]}>{stop.time}</Text>
            <Text modifiers={[font({ size: 11 }), foregroundStyle(stopColor(index)), lineLimit(1)]}>{stop.label}</Text>
          </HStack>
        ))}
      </VStack>
      <Spacer />
    </VStack>
  );
};

export default createWidget("LeaveWidget", LeaveWidget);
