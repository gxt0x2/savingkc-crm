import { createPreferencePost } from "@/lib/email/preferences/http";
import { workflowDatabase } from "@/lib/email/workflow/connection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const post = createPreferencePost(workflowDatabase);
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  return post(request, (await context.params).token);
}
