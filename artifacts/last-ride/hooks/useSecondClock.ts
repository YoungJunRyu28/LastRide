import { useEffect, useState } from "react";

/** Ticks every second so countdowns move; the app clock only ticks every 10s. */
export function useSecondClock(appNowMs: number, demoActive: boolean): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (demoActive) return;
    const base = Date.now();
    setOffset(0);
    const timer = setInterval(() => setOffset(Date.now() - base), 1000);
    return () => clearInterval(timer);
  }, [appNowMs, demoActive]);
  return demoActive ? appNowMs : appNowMs + offset;
}
