import * as Notifications from "expo-notifications";
import { router, usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { useLastRide } from "@/context/LastRideContext";
import { businessEnabled } from "@/lib/features";
import { shouldDeferNotificationNavigation } from "@/lib/notificationNavigation";
import type { NotificationTarget } from "@/lib/notifications";
import { BOARDED_ACTION, NOT_BOARDED_ACTION } from "@/lib/boarding";

const TARGETS: NotificationTarget[] = [
  "/ride",
  "/alternatives",
  "/business-event",
];

/**
 * Opens the screen a tapped notification points to. Personal reminders still
 * wait for onboarding; organizer alerts can open on an organizer-only device.
 */
export function NotificationRouter() {
  const response = Notifications.useLastNotificationResponse();
  const { isHydrated, homeStation, answerBoarding } = useLastRide();
  const pathname = usePathname();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response || !isHydrated) return;
    const data = response.notification.request.content.data;
    const target = data?.target;
    const isBusinessTarget = target === "/business-event";
    if (shouldDeferNotificationNavigation({
      target, pathname, hasHomeStation: Boolean(homeStation), businessEnabled,
    })) return;

    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    void Notifications.clearLastNotificationResponseAsync();

    // 乗れましたか？: 〔乗った〕 / 〔乗れなかった〕 (lib/boarding.ts). A plain tap opens
    // the home screen, which asks the same question.
    const departsAt = typeof data?.boardedCheck === "number" ? data.boardedCheck : undefined;
    if (departsAt !== undefined && response.actionIdentifier === BOARDED_ACTION) void answerBoarding(true, departsAt);
    if (departsAt !== undefined && response.actionIdentifier === NOT_BOARDED_ACTION) void answerBoarding(false, departsAt);

    if (isBusinessTarget && typeof data?.eventId === "string") {
      router.replace({
        pathname: "/business-event",
        params: { id: data.eventId },
      });
      return;
    }
    if (target === "/groups") {
      if (typeof data?.groupId === "string")
        router.push({ pathname: "/group/[id]", params: { id: data.groupId } });
      else router.replace("/groups");
      return;
    }
    if (TARGETS.includes(target as NotificationTarget) && target !== pathname) {
      router.replace(target as "/ride" | "/alternatives");
    }
  }, [response, isHydrated, homeStation, pathname, answerBoarding]);

  return null;
}
