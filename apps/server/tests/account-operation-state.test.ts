import { describe, expect, it } from "vitest";
import { AccountOperationState } from "../src/steam/account-operation-state.js";

describe("AccountOperationState", () => {
  it("keeps operations for one account serial while allowing other accounts to proceed", async () => {
    const state = new AccountOperationState();
    const events: string[] = [];
    let releaseFirst = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = state.run("account-a", async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      return "first";
    });
    const second = state.run("account-a", async () => {
      events.push("second");
      return "second";
    });
    const otherAccount = state.run("account-b", async () => {
      events.push("other");
      return "other";
    });

    await otherAccount;
    expect(events).toEqual(["first:start", "other"]);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "second",
    ]);
    expect(events).toEqual(["first:start", "other", "first:end", "second"]);
  });

  it("continues an account queue after a failed operation and drains its tail", async () => {
    const state = new AccountOperationState();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failed = state.run("account-a", async () => {
      await gate;
      throw new Error("expected failure");
    });
    const following = state.run("account-a", async () => "continued");
    let drained = false;
    const drain = state.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);
    release();

    await expect(failed).rejects.toThrow("expected failure");
    await expect(following).resolves.toBe("continued");
    await drain;
    expect(drained).toBe(true);
  });

  it("applies fallback actions and expires operation metadata after its TTL", () => {
    let now = 1_000;
    const state = new AccountOperationState({
      contextTtlMs: 100,
      now: () => now,
    });

    state.remember("account-a", "start", {
      correlationId: "request-1",
      source: "api",
    });
    expect(state.metadata("account-a")).toEqual({
      correlationId: "request-1",
      source: "api",
      action: "start",
    });

    now = 1_100;
    expect(state.metadata("account-a")).toEqual({});

    state.remember("account-a", "start", {
      action: "resume",
      scheduleId: "schedule-1",
    });
    expect(state.metadata("account-a")).toEqual({
      action: "resume",
      scheduleId: "schedule-1",
    });
    state.clearContext("account-a");
    expect(state.metadata("account-a")).toEqual({});

    state.remember("account-b", "stop", {});
    state.clearContexts();
    expect(state.metadata("account-b")).toEqual({});
  });
});
