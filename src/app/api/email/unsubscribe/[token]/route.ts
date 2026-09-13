import { createPreferencePost } from "@/lib/email/preferences/http";
import { pilotDatabase } from "@/lib/email/workflow/connection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const post = createPreferencePost(pilotDatabase);
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  return post(request, (await context.params).token);
}
