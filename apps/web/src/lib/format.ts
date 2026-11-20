export { formatSar } from "@tathkara/shared";

const DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Asia/Riyadh",
});
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });
const FULL = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Riyadh",
});

export const formatDate = (iso: string) => DATE.format(new Date(iso));
export const formatTime = (iso: string) => TIME.format(new Date(iso));
export const formatFull = (iso: string) => FULL.format(new Date(iso));

export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
