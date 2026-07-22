import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  api,
  apiDownload,
  authExpiredEvent,
  isAbortError,
  setCsrfToken,
} from "../src/api";

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

  it("downloads binary backups with CSRF protection and filename metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("encrypted", {
        status: 200,
        headers: {
          "content-disposition": 'attachment; filename="steam-bee.sbb"',
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setCsrfToken("csrf-token");

    const result = await apiDownload("/api/admin/backup", {
      method: "POST",
      body: JSON.stringify({ passphrase: "long enough passphrase" }),
    });

    expect(result.filename).toBe("steam-bee.sbb");
    expect(result.blob.size).toBe("encrypted".length);
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(request.headers).get("x-csrf-token")).toBe("csrf-token");
    setCsrfToken(null);
  });

  it("announces an expired session for authenticated downloads", async () => {
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

    await expect(
      apiDownload("/api/admin/backup", { method: "POST" }),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    } satisfies Partial<ApiError>);
    expect(listener).toHaveBeenCalledOnce();
  });
});
