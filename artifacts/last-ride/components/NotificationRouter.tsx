import * as Notifications from "expo-notifications";
import { router, usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { useLastRide } from "@/context/LastRideContext";
import type { NotificationTarget } from "@/lib/notifications";

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
  const { isHydrated, homeStation } = useLastRide();
  const pathname = usePathname();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response || !isHydrated) return;
    const data = response.notification.request.content.data;
    const target = data?.target;
    const isBusinessTarget = target === "/business-event";
    if (!isBusinessTarget && !homeStation) return;
    if (!isBusinessTarget && (pathname === "/" || pathname === "/home-station"))
      return;

    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    void Notifications.clearLastNotificationResponseAsync();

    if (isBusinessTarget && typeof data?.eventId === "string") {
      router.replace({
        pathname: "/business-event",
        params: { id: data.eventId },
      });
      return;
    }
    if (TARGETS.includes(target as NotificationTarget) && target !== pathname) {
      router.replace(target as "/ride" | "/alternatives");
    }
  }, [response, isHydrated, homeStation, pathname]);

  return null;
}
