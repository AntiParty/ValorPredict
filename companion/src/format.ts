// SQLite's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker, which
// `new Date()` would read as local time. Other timestamps are full RFC 3339 strings.
const SQLITE_UTC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(SQLITE_UTC.test(value) ? `${value.replace(" ", "T")}Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Not yet";
  const date = parseTimestamp(value);
  return date ? date.toLocaleString() : value;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago"; older than a week falls back to the date. */
export function formatRelative(
  value: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!value) return "Not yet";
  const date = parseTimestamp(value);
  if (!date) return value;

  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return date.toLocaleDateString();
}

/** Fills `{streamer}` in a prediction title template with the streamer's Twitch login. */
export function renderTitle(template: string, login: string): string {
  return template.replaceAll("{streamer}", login);
}

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function initials(name: string): string {
  return (
    name
      .split(/[\s_-]+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "U"
  );
}
