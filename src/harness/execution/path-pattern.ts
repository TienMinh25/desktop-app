export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/")
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error("Glob patterns must stay inside the selected workspace")
  }
  let expression = "^"
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] ?? ""
    const next = normalized[index + 1]
    if (char === "*" && next === "*") {
      index += 1
      if (normalized[index + 1] === "/") { expression += "(?:.*/)?"; index += 1 }
      else expression += ".*"
    } else if (char === "*") expression += "[^/]*"
    else if (char === "?") expression += "[^/]"
    else expression += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char
  }
  return new RegExp(`${expression}$`)
}
