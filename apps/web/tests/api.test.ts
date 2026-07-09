import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, authExpiredEvent, isAbortError } from "../src/api";

describe("API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps malformed JSON responses to a stable error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(api("/api/accounts")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 502,
    } satisfies Partial<ApiError>);
  });

  it("announces an expired authenticated session on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Authentication required.",
            code: "AUTH_REQUIRED",
          }),
          { status: 401 },
        ),
      ),
    );
    const listener = vi.fn();
    window.addEventListener(authExpiredEvent, listener, { once: true });

    await expect(api("/api/accounts")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    } satisfies Partial<ApiError>);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("recognizes expected request cancellation errors", () => {
    expect(
      isAbortError(new DOMException("Request cancelled", "AbortError")),
    ).toBe(true);
    expect(isAbortError(new Error("Network failed"))).toBe(false);
  });
});
