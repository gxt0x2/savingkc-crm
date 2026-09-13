import { resolveAuthenticatedActor } from "@/lib/api/authenticated-actor";
import { emailDatabase } from "@/lib/email/workflow/connection";
import { sameOrigin, workflowErrorResponse } from "@/lib/email/workflow/http";
import { check } from "@/lib/email/workflow/core";
import { importAudience } from "@/lib/email/audiences/import";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    check(sameOrigin(request), "INVALID_ORIGIN", 403);
    check(
      request.headers.get("content-type")?.startsWith("application/json"),
      "JSON_REQUIRED",
      415,
    );
    const actor = await resolveAuthenticatedActor(request);
    check(actor?.subject, "SIGN_IN_REQUIRED", 401);
    const text = await request.text();
    check(text.length <= 256000, "IMPORT_TOO_LARGE", 413);
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      check(false, "INVALID_JSON", 400);
    }
    return Response.json(
      await importAudience(emailDatabase(), actor.subject, input),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
