import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../preferences/service", () => ({
  preferenceTokenPattern: /^[1-9][0-9]{0,3}\.[A-Za-z0-9_-]{43}$/,
  unsubscribeWithToken: vi.fn(),
}));
import { unsubscribeWithToken } from "../preferences/service";
import {
  createPreferencePost,
  preferenceConfirmation,
} from "../preferences/http";
const token = "1." + "x".repeat(43);
const database = vi.fn();
const post = createPreferencePost(database);
const request = (
  body = "List-Unsubscribe=One-Click",
  type = "application/x-www-form-urlencoded",
) =>
  new Request("https://crm.test", {
    method: "POST",
    headers: { "Content-Type": type },
    body,
  });
describe("public email preferences", () => {
  it("GET confirms without database mutation or external resources", async () => {
    const response = preferenceConfirmation(token);
    const html = await response.text();
    expect(html).toContain("Unsubscribe</button>");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).not.toContain("<script");
    expect(database).not.toHaveBeenCalled();
    expect(preferenceConfirmation("<script>").status).toBe(400);
  });
  it("rejects malformed, oversized, and duplicate actions", async () => {
    expect((await post(request(), "<bad>")).status).toBe(400);
    expect((await post(request("{}", "application/json"), token)).status).toBe(
      415,
    );
    expect((await post(request("x".repeat(1025)), token)).status).toBe(413);
    expect(
      (
        await post(
          request("List-Unsubscribe=One-Click&List-Unsubscribe=One-Click"),
          token,
        )
      ).status,
    ).toBe(400);
  });
  it("never claims success on a missing token or a database failure", async () => {
    vi.mocked(unsubscribeWithToken).mockResolvedValueOnce(false);
    expect((await post(request(), token)).status).toBe(400);
    vi.mocked(unsubscribeWithToken).mockRejectedValueOnce(
      new Error("private database detail"),
    );
    const failed = await post(request(), token);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private database detail");
    vi.mocked(unsubscribeWithToken).mockResolvedValueOnce(true);
    const success = await post(request(), token);
    expect(success.status).toBe(200);
    expect(await success.text()).toContain("You’re unsubscribed");
  });
});
