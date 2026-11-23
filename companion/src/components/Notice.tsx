import type { NoticeState } from "../hooks/useNotice";

// The one inline message used everywhere. Errors are announced assertively; successes
// politely. Pair with `useNotice` so successes clear themselves.
export function Notice({ notice }: { notice: NoticeState }) {
  if (!notice) return null;
  return (
    <div
      className={`notice ${notice.kind}`}
      role={notice.kind === "success" ? "status" : "alert"}
    >
      {notice.message}
    </div>
  );
}
