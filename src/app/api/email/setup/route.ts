import { resolveAuthenticatedActor } from "@/lib/api/authenticated-actor";
import { emailDatabase } from "@/lib/email/workflow/connection";
import { createHostedSetupHttp } from "@/lib/email/setup/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const handlers = createHostedSetupHttp({
  database: emailDatabase,
  subject: async (request) =>
    (await resolveAuthenticatedActor(request))?.subject ?? null,
});
export const GET = handlers.GET;
export const POST = handlers.POST;
