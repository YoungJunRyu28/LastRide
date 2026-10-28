/** iOS uses MapKit. Android platform module overrides this fallback. */
export async function nativeAddressSearch(_query: string): Promise<Array<{ label: string; latitude: number; longitude: number }> | null> { return null; }
