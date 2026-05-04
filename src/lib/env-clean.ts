export function cleanEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let out = value.trim();

  // Strip wrapping quotes from copied env values.
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1).trim();
  }

  // Remove accidental escaped newlines or real newlines from secret values.
  out = out.replace(/\\n/g, "").replace(/\r?\n/g, "").trim();
  return out || undefined;
}

export function getEnv(name: string): string | undefined {
  return cleanEnv(process.env[name]);
}

export function getRequiredEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}
