export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPercent(value: number | null): string {
  return value === null
    ? "—"
    : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;
}

export function formatDateTime(value: string | null): string {
  if (value === null) return "Not completed";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function compactHash(value: string | null): string {
  if (value === null) return "Genesis";
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export function eventDomId(eventId: string): string {
  return `event-${eventId.replace(/[^a-zA-Z0-9_-]/gu, "-")}`;
}
