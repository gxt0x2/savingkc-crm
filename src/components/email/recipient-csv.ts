/** Small bounded CSV parser; supports quoted commas, newlines and escaped quotes. */
export function parseRecipientCsv(text: string) {
  if (text.length > 200000)
    throw new Error("Use a CSV with up to 200 recipients.");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (!quoted && field !== "")
        throw new Error("Check the CSV quotation marks.");
      else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Check the CSV quotation marks.");
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  const headers =
    rows.shift()?.map((v) =>
      v
        .replace(/^\uFEFF/, "")
        .trim()
        .toLowerCase(),
    ) ?? [];
  if (!headers.includes("name") || !headers.includes("email"))
    throw new Error("Include name and email column headings.");
  if (rows.length < 1 || rows.length > 200)
    throw new Error("Import 1–200 recipients at a time.");
  return rows.map((values) => {
    if (values.length !== headers.length)
      throw new Error("Each CSV row must match the column headings.");
    const get = (name: string) => values[headers.indexOf(name)]?.trim();
    return {
      name: get("name") ?? "",
      email: get("email") ?? "",
      verificationStatus:
        get("verification_status")?.toLowerCase() || "unknown",
      ...(get("verified_at") ? { verifiedAt: get("verified_at") } : {}),
      ...(get("verification_source")
        ? { verificationSource: get("verification_source") }
        : {}),
    };
  });
}
