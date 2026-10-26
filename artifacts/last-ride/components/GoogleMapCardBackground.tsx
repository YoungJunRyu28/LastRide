/** Non-Android platforms use MapKit snapshot or the illustrated fallback. */
import type { MapFrame, Pin, Point } from '@/lib/googleMapGeometry';
export const googleMapsConfigured = false;
export default function GoogleMapCardBackground(_props: {
  frame: MapFrame; you?: Point | null; target?: Point | null;
  path?: Point[]; pins?: Pin[]; stationTag?: string; walkLabel?: string;
}) { return null; }
