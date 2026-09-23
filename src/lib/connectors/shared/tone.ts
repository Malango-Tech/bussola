import type { TrackerPoint } from "../types";

export type Tone = TrackerPoint["status"];

/**
 * The tracker bar colour for each tone. Deploy trails from Railway, Netlify
 * and Vercel sit side by side on a dashboard, so they must agree on it.
 */
const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  error: "bg-destructive",
  idle: "bg-muted-foreground/30",
};

export function toneClass(tone: Tone): string {
  return TONE_CLASS[tone];
}
