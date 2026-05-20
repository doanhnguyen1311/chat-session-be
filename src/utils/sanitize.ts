export function sanitizeMessage(content: string): string {
  return content.replace(/[<>&"']/g, (char) => {
    const map: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "\"": "&quot;",
      "'": "&#39;"
    };
    return map[char] ?? char;
  });
}

export function normalizeDisplayName(displayName: string): string {
  return displayName.replace(/\s+/g, " ").trim();
}
