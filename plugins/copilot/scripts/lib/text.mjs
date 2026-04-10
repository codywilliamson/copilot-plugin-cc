export function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}

export function firstMeaningfulLine(text, fallback = "") {
  return (
    String(text ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? fallback
  );
}

export function stripMarkdownCodeFence(value) {
  const trimmed = String(value ?? "").trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

export function parseStructuredOutput(rawOutput) {
  const raw = String(rawOutput ?? "").trim();
  if (!raw) {
    return { parsed: null, rawOutput: raw, parseError: "Copilot returned an empty final message." };
  }
  try {
    return { parsed: JSON.parse(stripMarkdownCodeFence(raw)), rawOutput: raw, parseError: null };
  } catch (error) {
    return { parsed: null, rawOutput: raw, parseError: error instanceof Error ? error.message : String(error) };
  }
}
