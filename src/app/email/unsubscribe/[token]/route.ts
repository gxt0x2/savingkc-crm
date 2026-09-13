import { preferenceConfirmation } from "@/lib/email/preferences/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  return preferenceConfirmation((await context.params).token);
}
