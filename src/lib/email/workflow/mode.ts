/** Local delivery and synthetic inbound must never operate on a hosted workspace. */
export function commandAllowedInMode(command: string, mode: string) {
  if (command.startsWith("LOCAL-")) return mode === "simulation";
  return mode === "simulation" || mode === "hosted";
}
