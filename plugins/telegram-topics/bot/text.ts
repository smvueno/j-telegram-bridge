export function splitMessage(text: string, limit = 4096): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return ["(no answer)"];
  }
  if (trimmed.length <= limit) {
    return [trimmed];
  }

  const parts: string[] = [];
  let remaining = trimmed;

  while (remaining.length > limit) {
    let window = remaining.slice(0, limit);
    let breakAt = window.lastIndexOf("\n");
    if (breakAt <= 0) {
      breakAt = window.lastIndexOf(" ");
    }
    if (breakAt <= 0) {
      breakAt = limit;
    }
    parts.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
}

export function extractSendFiles(text: string): { text: string; files: string[] } {
  const files: string[] = [];
  const kept: string[] = [];

  for (const line of text.split("\n")) {
    const match = line.match(/^SEND_FILE:\s*(.+)$/);
    if (match) {
      const path = match[1]!.trim();
      if (path.startsWith("/")) {
        files.push(path);
      }
      continue;
    }
    kept.push(line);
  }

  return { text: kept.join("\n"), files };
}

export function stepLabel(
  toolName: string,
  input: Record<string, unknown>,
): string {
  if (toolName === "Bash" && typeof input.command === "string") {
    return `Bash: ${input.command.slice(0, 80)}`;
  }
  if (toolName === "Read" && typeof input.file_path === "string") {
    return `Read: ${input.file_path}`;
  }
  return toolName;
}