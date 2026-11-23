import { useEffect, useState } from "react";

import { formatDate, formatRelative } from "../format";
import { useWindowVisible } from "../hooks/useWindowVisible";

const TICK_MS = 30_000;

// "5 min ago" with the full date in the tooltip. Re-renders every 30 s, and only while
// the window is on screen.
export function RelativeTime({ value }: { value: string | null | undefined }) {
  const visible = useWindowVisible();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => setTick((tick) => tick + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, [visible]);

  return (
    <time dateTime={value ?? undefined} title={formatDate(value)}>
      {formatRelative(value)}
    </time>
  );
}
