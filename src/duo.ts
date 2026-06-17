import type { DuoMember } from "./types.js";

export const DEFAULT_DUO_TEMPLATE = "Currently queued with: {names}";
export const DEFAULT_DUO_FALLBACK = "Not queued with anyone right now.";

/** How long a party snapshot stays trustworthy before we serve the fallback. */
export const DUO_STALENESS_MS = 10 * 60 * 1000;

/** Plain-text cap so chatbot `$(urlfetch)` consumers stay within message limits. */
export const DUO_MAX_LENGTH = 380;

export interface RenderDuoTextInput {
  /** Streamer template; `{names}` is replaced with the rendered member list. */
  template: string;
  /** Served whenever there is nothing trustworthy to show. */
  fallbackText: string;
  /** Whether the companion last reported being in a party. */
  inParty: boolean;
  /** Party members already filtered for Incognito and self by the companion. */
  members: DuoMember[];
  /** Per-Riot-ID display overrides ("TenZ#NA1" -> "the legend TenZ"). */
  shoutouts: Record<string, string>;
  /** ISO timestamp of when the snapshot was recorded, or null if never. */
  updatedAt: string | null;
  now?: number;
  stalenessMs?: number;
  maxLength?: number;
}

export function renderDuoText(input: RenderDuoTextInput): string {
  const {
    template,
    fallbackText,
    inParty,
    members,
    shoutouts,
    updatedAt,
    now = Date.now(),
    stalenessMs = DUO_STALENESS_MS,
    maxLength = DUO_MAX_LENGTH,
  } = input;

  if (!inParty || members.length === 0) {
    return fallbackText;
  }

  if (!updatedAt) {
    return fallbackText;
  }
  const recordedAt = new Date(updatedAt).getTime();
  if (Number.isNaN(recordedAt) || now - recordedAt > stalenessMs) {
    return fallbackText;
  }

  const names = members
    .map((member) => shoutouts[member.riotId] ?? member.name)
    .join(", ");

  const rendered = template.includes("{names}")
    ? template.replaceAll("{names}", names)
    : `${template} ${names}`.trim();

  return capLength(rendered, maxLength);
}

function capLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
