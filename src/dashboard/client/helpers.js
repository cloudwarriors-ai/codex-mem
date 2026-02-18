export function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function readInput(value) {
  const trimmed = String(value || "").trim();
  return trimmed.length > 0 ? trimmed : "";
}

export function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString();
}

export function shorten(text, maxLen) {
  const value = String(text || "");
  return value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;
}

export function readErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
