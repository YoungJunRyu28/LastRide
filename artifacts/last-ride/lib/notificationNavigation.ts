/** Pure gate for navigation triggered by tapped local or remote notifications. */
export function shouldDeferNotificationNavigation({
  target, pathname, hasHomeStation, businessEnabled,
}: {
  target: unknown;
  pathname: string;
  hasHomeStation: boolean;
  businessEnabled: boolean;
}): boolean {
  const business = target === "/business-event";
  const group = target === "/groups";
  if (business && !businessEnabled) return true;
  // Groups and organizer events work without personal commute setup.
  if (!business && !group && !hasHomeStation) return true;
  if (!business && !group && (pathname === "/" || pathname === "/home-station"))
    return true;
  return false;
}
