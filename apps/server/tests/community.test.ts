import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/steam/manager.js", () => ({
  steamManager: { getCommunitySession: vi.fn() },
}));

import { createCommunityRequest } from "../src/steam/community.js";

const SESSION = {
  steamId: "76561198000000001",
  sessionId: "authoritative-session",
  cookies: [
    "sessionid=authoritative-session",
    "steamLoginSecure=private-login-cookie",
  ],
};

function harness() {
  const sessionFor = vi.fn(async () => ({
    ...SESSION,
    cookies: [...SESSION.cookies],
  }));
  const fetcher = vi.fn<typeof fetch>();
  const request = createCommunityRequest(sessionFor, fetcher);
  return { sessionFor, fetcher, request };
}

describe("Steam Community HTTP transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not submit a stopped batch after waiting for a web session", async () => {
    let resolveSession!: (session: typeof SESSION) => void;
    let running = true;
    const fetcher = vi.fn<typeof fetch>();
    const request = createCommunityRequest(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        }),
      fetcher,
    );
    const pending = request("account-one", "/market/sellitem/", {
      method: "POST",
      shouldContinue: () => running,
      form: { assetid: "9" },
    });
    running = false;
    resolveSession(SESSION);
    await expect(pending).rejects.toMatchObject({
      statusCode: 409,
      message: "Market batch stopped before submission.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("authenticates only a fixed Steam Community destination and strips upstream headers", async () => {
    const { sessionFor, fetcher, request } = harness();
    fetcher.mockResolvedValueOnce(
      new Response('{"success":true}', {
        headers: {
          "content-type": "application/json",
          "set-cookie": "secret=upstream-cookie",
          location: "https://external.example/",
          "x-request-cookie": SESSION.cookies.join("; "),
        },
      }),
    );

    const response = await request(
      "account-one",
      "/inventory/76561198000000001/753/6?count=20",
    );
    expect(sessionFor).toHaveBeenCalledWith("account-one");
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://steamcommunity.com/inventory/76561198000000001/753/6?count=20",
    );
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    const headers = new Headers(init?.headers);
    expect(headers.get("cookie")).toBe(SESSION.cookies.join("; "));
    expect(headers.get("origin")).toBe("https://steamcommunity.com");
    expect(headers.get("referer")).toBe("https://steamcommunity.com/market/");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect([...response.headers.keys()]).toEqual(["content-type"]);
    expect(await response.json()).toEqual({ success: true });
  });

  it.each([
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "/\\attacker.example/steal",
    "/market/\r\nInjected: true",
    "/market/\0bad",
    "market/relative",
  ])(
    "rejects hostile destination %j before obtaining cookies",
    async (path) => {
      const { sessionFor, fetcher, request } = harness();
      await expect(request("account-one", path)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(sessionFor).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("keeps encoded path content on the fixed host", async () => {
    const { fetcher, request } = harness();
    fetcher.mockResolvedValueOnce(new Response("ok"));
    await request("account-one", "/%2F%2Fattacker.example/steal");
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).origin).toBe(
      "https://steamcommunity.com",
    );
  });

  it("never follows redirects carrying Steam cookies to another host", async () => {
    const { fetcher, request } = harness();
    const cancel = vi.fn();
    fetcher.mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel }), {
        status: 302,
        headers: { location: "https://attacker.example/steal" },
      }),
    );
    await expect(request("account-one", "/market/")).rejects.toMatchObject({
      statusCode: 409,
      message: "Steam Community requires a renewed sign-in.",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("discards the cached web session when Steam sends it to sign in", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const discard = vi.fn();
    const request = createCommunityRequest(
      async () => SESSION,
      fetcher,
      Date.now,
      discard,
    );
    fetcher.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://steamcommunity.com/login/home/" },
      }),
    );
    await expect(request("account-one", "/market/")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(discard).toHaveBeenCalledWith("account-one", SESSION.sessionId);
  });

  it("follows a same-host redirect to the profile's custom URL", async () => {
    const { fetcher, request } = harness();
    fetcher
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://steamcommunity.com/id/custom-name/gamecards/730?l=english",
          },
        }),
      )
      .mockResolvedValueOnce(new Response("badge page"));
    const response = await request(
      "account-one",
      "/profiles/76561198000000001/gamecards/730/?l=english",
    );
    expect(await response.text()).toBe("badge page");
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      "https://steamcommunity.com/id/custom-name/gamecards/730?l=english",
    );
    expect(fetcher.mock.calls[1]?.[1]?.redirect).toBe("manual");
  });

  it.each(["https://steamcommunity.com/login/home/?goto=market", "/market/"])(
    "treats a redirect to %j as an expired sign-in",
    async (location) => {
      const { fetcher, request } = harness();
      fetcher.mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location } }),
      );
      await expect(
        request("account-one", "/profiles/76561198000000001/badges/"),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("passes the market eligibility check and reuses its cookie", async () => {
    const { fetcher, request } = harness();
    const check = new Headers({
      location: "https://steamcommunity.com/market/",
    });
    check.append(
      "set-cookie",
      "webTradeEligibility=%7B%22allowed%22%3A1%7D; Max-Age=600; path=/; HttpOnly",
    );
    check.append("set-cookie", "sessionid=attacker-session; Path=/");
    fetcher
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/market/eligibilitycheck/?goto=%2Fmarket%2F" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: check }),
      )
      .mockResolvedValueOnce(new Response("market"))
      .mockResolvedValueOnce(new Response("market again"));
    const response = await request("account-one", "/market/?l=english");
    expect(await response.text()).toBe("market");
    expect(fetcher).toHaveBeenCalledTimes(3);
    const cookieOf = (call: number) =>
      new Headers(fetcher.mock.calls[call]?.[1]?.headers).get("cookie");
    expect(cookieOf(2)).toBe(
      [...SESSION.cookies, "webTradeEligibility=%7B%22allowed%22%3A1%7D"].join(
        "; ",
      ),
    );
    await request("account-one", "/market/?l=english");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(cookieOf(3)).toBe(cookieOf(2));
  });

  it("does not leave the market check for a non-market path", async () => {
    const { fetcher, request } = harness();
    fetcher
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/market/eligibilitycheck/" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/login/home/" },
        }),
      );
    await expect(request("account-one", "/market/")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops after three profile redirects", async () => {
    const { fetcher, request } = harness();
    fetcher.mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "/id/loop/badges/" },
        }),
    );
    await expect(
      request("account-one", "/profiles/76561198000000001/badges/"),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not replay a POST across a redirect", async () => {
    const { fetcher, request } = harness();
    fetcher.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "/id/custom-name/badges/" },
      }),
    );
    await expect(
      request("account-one", "/market/sellitem/", { method: "POST" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("always uses the broker's session ID when submitting form data", async () => {
    const { fetcher, request } = harness();
    fetcher.mockResolvedValueOnce(new Response("ok"));
    await request("account-one", "/market/sellitem/", {
      method: "POST",
      form: {
        sessionid: "untrusted-session",
        appid: "753",
        price: "100",
        assetid: "9",
      },
    });
    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(String(init?.body));
    expect(body.getAll("sessionid")).toEqual([SESSION.sessionId]);
    expect(body.get("assetid")).toBe("9");
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded; charset=UTF-8",
    );
  });

  it("provides a twenty-second abort deadline and sanitizes timeout errors", async () => {
    const { fetcher, request } = harness();
    const controller = new AbortController();
    const deadline = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    fetcher.mockImplementation(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error(`request failed: ${SESSION.cookies[1]}`)),
            { once: true },
          );
        }),
    );
    const pending = request("account-one", "/market/");
    const failure = expect(pending).rejects.toMatchObject({
      statusCode: 502,
      message: "Steam Community request failed. Try again after reconnecting.",
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(deadline).toHaveBeenCalledWith(20_000);
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    controller.abort();
    await failure;
  });

  it("sanitizes fetch errors even when they carry a statusCode field", async () => {
    const { fetcher, request } = harness();
    fetcher.mockRejectedValueOnce(
      Object.assign(new Error(`failed with ${SESSION.cookies[1]}`), {
        statusCode: 418,
      }),
    );
    await expect(request("account-one", "/market/")).rejects.toMatchObject({
      statusCode: 502,
      message: "Steam Community request failed. Try again after reconnecting.",
    });
  });

  it("rejects a streamed response over ten MiB and cancels the remaining body", async () => {
    const { fetcher, request } = harness();
    const cancel = vi.fn();
    let emitted = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!emitted) {
          controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
          emitted = true;
        }
      },
      cancel,
    });
    fetcher.mockResolvedValueOnce(
      new Response(stream, { headers: { "content-length": "1" } }),
    );
    await expect(request("account-one", "/market/")).rejects.toMatchObject({
      statusCode: 502,
      message: "Steam Community response exceeded the size limit.",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([204, 205])(
    "preserves an empty HTTP %i response for market cancellation readback",
    async (status) => {
      const { fetcher, request } = harness();
      fetcher.mockResolvedValueOnce(new Response(null, { status }));
      const response = await request(
        "account-one",
        "/market/removelisting/123",
        { method: "POST" },
      );
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
    },
  );

  it("accepts a response exactly at the ten MiB boundary", async () => {
    const { fetcher, request } = harness();
    fetcher.mockResolvedValueOnce(
      new Response(new Uint8Array(10 * 1024 * 1024)),
    );
    const response = await request("account-one", "/market/");
    expect((await response.arrayBuffer()).byteLength).toBe(10 * 1024 * 1024);
  });

  it("sanitizes stream read errors and does not expose partial upstream bodies", async () => {
    const { fetcher, request } = harness();
    fetcher.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(
              new Error(`upstream failed with ${SESSION.cookies[1]}`),
            );
          },
        }),
      ),
    );
    await expect(request("account-one", "/market/")).rejects.toMatchObject({
      statusCode: 502,
      message: "Steam Community request failed. Try again after reconnecting.",
    });
  });
});
