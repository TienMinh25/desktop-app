const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #2563eb, #1d4ed8)",
  "linear-gradient(135deg, #7c3aed, #5b21b6)",
  "linear-gradient(135deg, #059669, #047857)",
  "linear-gradient(135deg, #ea580c, #c2410c)",
  "linear-gradient(135deg, #db2777, #9d174d)",
  "linear-gradient(135deg, #0284c7, #0369a1)",
  "linear-gradient(135deg, #4f46e5, #3730a3)",
  "linear-gradient(135deg, #d97706, #b45309)",
] as const

export function splitTitleAndBody(raw: string): { title: string; body: string } {
  const lines = raw.split("\n")
  if (lines.length <= 1) {
    return { title: raw, body: "" }
  }
  return {
    title: lines[0] ?? raw,
    body: lines.slice(1).join("\n").trim(),
  }
}

export function splitHighlightParts(
  text: string,
  query: string | undefined,
): Array<{ text: string; isMatch: boolean }> {
  if (!query) return [{ text, isMatch: false }]
  const pattern = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
  return text.split(pattern).map((part, index) => ({
    text: part,
    isMatch: index % 2 === 1,
  }))
}

export function getAvatarGradient(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length] ?? AVATAR_GRADIENTS[0]
}

export function getInitials(title: string, fallback = "MC"): string {
  const words = title.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase()
  }
  return (title.trim().slice(0, 2) || fallback).toUpperCase()
}

export function formatAddedDate(iso?: string): string {
  if (!iso) return "March 2026"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "March 2026"
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date)
}
