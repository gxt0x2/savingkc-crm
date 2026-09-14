import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const postgres = vi.hoisted(() =>
  vi.fn((url: string) => ({ kind: "sql", url })),
);
vi.mock("postgres", () => ({ default: postgres }));

const capture = vi.hoisted(() => ({
  createResendWebhookHttp: vi.fn((deps: { database: unknown }) => deps),
}));
vi.mock("@/lib/email/inbound/capture", () => ({
  createResendWebhookHttp: capture.createResendWebhookHttp,
}));

const crmFallbacks = {
  DATABASE_URL: "postgres://crm-module.example/crm",
  SUPABASE_DB_URL: "postgres://supabase.example/postgres",
  POSTGRES_URL: "postgres://vercel.example/postgres",
};

async function loadConnection() {
  return import("../workflow/connection");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  postgres.mockClear();
  capture.createResendWebhookHttp.mockClear();
});

function stubCrmFallbacks() {
  for (const [name, value] of Object.entries(crmFallbacks)) {
    vi.stubEnv(name, value);
  }
}

describe("pilotDatabase", () => {
  it("requires simulation mode and EMAIL_DATABASE_URL", async () => {
    const { pilotDatabase } = await loadConnection();
    stubCrmFallbacks();
    vi.stubEnv("EMAIL_WORKFLOW_MODE", "hosted");
    vi.stubEnv("EMAIL_DATABASE_URL", "postgres://email.example/email");
    expect(() => pilotDatabase()).toThrow(
      expect.objectContaining({
        code: "EMAIL_SETUP_REQUIRED",
        status: 503,
      }),
    );
    expect(postgres).not.toHaveBeenCalled();
  });

  it("rejects simulation mode without EMAIL_DATABASE_URL and never uses CRM URLs", async () => {
    const { pilotDatabase } = await loadConnection();
    stubCrmFallbacks();
    vi.stubEnv("EMAIL_WORKFLOW_MODE", "simulation");
    expect(() => pilotDatabase()).toThrow(
      expect.objectContaining({
        code: "EMAIL_SETUP_REQUIRED",
        status: 503,
      }),
    );
    expect(postgres).not.toHaveBeenCalled();
  });

  it("connects only with simulation mode and EMAIL_DATABASE_URL", async () => {
    const { pilotDatabase } = await loadConnection();
    stubCrmFallbacks();
    vi.stubEnv("EMAIL_WORKFLOW_MODE", "simulation");
    vi.stubEnv("EMAIL_DATABASE_URL", "postgres://email.example/sim");
    expect(pilotDatabase()).toEqual({
      kind: "sql",
      url: "postgres://email.example/sim",
    });
    expect(postgres).toHaveBeenCalledWith(
      "postgres://email.example/sim",
      expect.objectContaining({ max: 3, prepare: false }),
    );
  });
});

describe("emailDatabase", () => {
  it("requires hosted mode and EMAIL_DATABASE_URL", async () => {
    const { emailDatabase } = await loadConnection();
    stubCrmFallbacks();
    vi.stubEnv("EMAIL_WORKFLOW_MODE", "simulation");
    vi.stubEnv("EMAIL_DATABASE_URL", "postgres://email.example/email");
    expect(() => emailDatabase()).toThrow(
      expect.objectContaining({
        code: "EMAIL_HOSTED_SETUP_REQUIRED",
        status: 503,
      }),
    );
    expect(postgres).not.toHaveBeenCalled();
  });

  it("rejects hosted mode without EMAIL_DATABASE_URL and never uses CRM URLs", async () => {
    const { emailDatabase } = await loadConnection();
    stubCrmFallbacks();
    vi.stubEnv("EMAIL_WORKFLOW_MODE", "hosted");
    expect(() => emailDatabase()).toThrow(
      expect.objectContaining({
        code: "EMAIL_HOSTED_SETUP_REQUIRED",
        status: 503,
      }),
    );
    expect(postgres).not.toHaveBeenCalled();
  });

  it("connects only with hosted mode and EMAIL_DATABASE_URL", async () => {
    const { emailDatabase } = await loadConnection();
    stubCrmFallbacks();
    vi.stubEnv("EMAIL_WORKFLOW_MODE", "hosted");
    vi.stubEnv("EMAIL_DATABASE_URL", "postgres://atlas.example/email");
    expect(emailDatabase()).toEqual({
      kind: "sql",
      url: "postgres://atlas.example/email",
    });
    expect(postgres).toHaveBeenCalledWith(
      "postgres://atlas.example/email",
      expect.objectContaining({ max: 3, prepare: false }),
    );
  });
});

describe("hosted route wiring", () => {
  it("wires the Resend webhook to the hosted helper", async () => {
    const { POST } = await import("@/app/api/webhooks/email/resend/route");
    expect(capture.createResendWebhookHttp).toHaveBeenCalledOnce();
    const wired = POST as unknown as { database: () => unknown };
    stubCrmFallbacks();
    vi.stubEnv("EMAIL_WORKFLOW_MODE", "simulation");
    vi.stubEnv("EMAIL_DATABASE_URL", "postgres://email.example/sim");
    expect(() => wired.database()).toThrow(
      expect.objectContaining({
        code: "EMAIL_HOSTED_SETUP_REQUIRED",
        status: 503,
      }),
    );
    vi.stubEnv("EMAIL_WORKFLOW_MODE", "hosted");
    vi.stubEnv("EMAIL_DATABASE_URL", "postgres://atlas.example/email");
    expect(wired.database()).toEqual({
      kind: "sql",
      url: "postgres://atlas.example/email",
    });
  });

  it("routes workspace, receiving, preferences and workers through explicit mode selection", () => {
    const hosted = [
      "src/app/api/webhooks/email/resend/route.ts",
      "src/app/api/email/connections/route.ts",
      "src/app/api/email/domains/route.ts",
    ];
    const modeSelected = [
      "src/app/api/workers/email/route.ts",
      "src/app/api/email/workspace/route.ts",
      "src/app/api/email/receiving/route.ts",
      "src/app/api/email/unsubscribe/[token]/route.ts",
    ];
    for (const file of hosted) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("emailDatabase");
      expect(source).not.toContain("pilotDatabase");
    }
    for (const file of modeSelected) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("workflowDatabase");
      expect(source).not.toContain("emailDatabase");
    }
  });
});

describe("workflowDatabase", () => {
  it.each(["hosted", "simulation"])(
    "selects the explicit %s connection",
    async (mode) => {
      vi.stubEnv("EMAIL_WORKFLOW_MODE", mode);
      vi.stubEnv("EMAIL_DATABASE_URL", "postgres://email.example/selected");
      const { workflowDatabase } = await loadConnection();
      expect(workflowDatabase()).toEqual({
        kind: "sql",
        url: "postgres://email.example/selected",
      });
    },
  );
  it.each(["", "disabled", "production"])(
    "rejects unsupported mode %s",
    async (mode) => {
      vi.stubEnv("EMAIL_WORKFLOW_MODE", mode);
      vi.stubEnv("EMAIL_DATABASE_URL", "postgres://email.example/selected");
      const { workflowDatabase } = await loadConnection();
      expect(() => workflowDatabase()).toThrow(
        expect.objectContaining({ code: "EMAIL_HOSTED_SETUP_REQUIRED" }),
      );
      expect(postgres).not.toHaveBeenCalled();
    },
  );
});
