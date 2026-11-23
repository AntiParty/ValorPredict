import { useCallback, useEffect, useRef, useState } from "react";

export type NoticeState = { kind: "success" | "error"; message: string } | null;

export const SUCCESS_NOTICE_MS = 4000;

// One message slot per surface. Success clears itself after 4 s; an error stays until
// the next action replaces or clears it.
export function useNotice() {
  const [notice, setNotice] = useState<NoticeState>(null);
  const timer = useRef<number | undefined>(undefined);

  const stopTimer = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  useEffect(() => stopTimer, []);

  const clear = useCallback(() => {
    stopTimer();
    setNotice(null);
  }, []);

  const showError = useCallback((message: string) => {
    stopTimer();
    setNotice({ kind: "error", message });
  }, []);

  const showSuccess = useCallback((message: string) => {
    stopTimer();
    setNotice({ kind: "success", message });
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setNotice(null);
    }, SUCCESS_NOTICE_MS);
  }, []);

  return { notice, showSuccess, showError, clear };
}
