import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor';
import { emailDatabase } from '@/lib/email/workflow/connection';
import { sameOrigin, workflowErrorResponse } from '@/lib/email/workflow/http';
import { check } from '@/lib/email/workflow/core';
import { changeContactRules, readContactRules } from '@/lib/email/hygiene/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
    try {
        const actor = await resolveAuthenticatedActor(request);
        check(actor?.subject, 'SIGN_IN_REQUIRED', 401);
        return Response.json(await readContactRules(emailDatabase(), actor.subject, new URL(request.url).searchParams.get('threadId') ?? ''), { headers: { 'Cache-Control': 'private, no-store' } });
    }
    catch (error) {
        return workflowErrorResponse(error);
    }
}
export async function POST(request: Request) {
    try {
        check(sameOrigin(request), 'INVALID_ORIGIN', 403);
        check(request.headers.get('content-type')?.startsWith('application/json'), 'JSON_REQUIRED', 415);
        const actor = await resolveAuthenticatedActor(request);
        check(actor?.subject, 'SIGN_IN_REQUIRED', 401);
        const text = await request.text();
        check(text.length <= 5000, 'REQUEST_TOO_LARGE', 413);
        let body: unknown;
        try {
            body = JSON.parse(text);
        }
        catch {
            check(false, 'INVALID_JSON', 400);
        }
        return Response.json(await changeContactRules(emailDatabase(), actor.subject, body), { headers: { 'Cache-Control': 'private, no-store' } });
    }
    catch (error) {
        return workflowErrorResponse(error);
    }
}
