import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { parseTrustProxy } from "../src/config.js";

describe("explicit reverse proxy trust", () => {
  it.each([
    {
      configured: undefined,
      peer: "192.0.2.10",
      ip: "192.0.2.10",
      ips: undefined,
      trusted: false,
    },
    {
      configured: "192.0.2.10",
      peer: "198.51.100.9",
      ip: "198.51.100.9",
      ips: ["198.51.100.9"],
      trusted: false,
    },
    {
      configured: "192.0.2.10",
      peer: "192.0.2.10",
      ip: "203.0.113.8",
      ips: ["192.0.2.10", "203.0.113.8"],
      trusted: true,
    },
    {
      configured: "192.0.2.0/24",
      peer: "::ffff:192.0.2.10",
      ip: "203.0.113.8",
      ips: ["::ffff:192.0.2.10", "203.0.113.8"],
      trusted: true,
    },
    {
      configured: "2001:db8::10",
      peer: "2001:db8::10",
      ip: "203.0.113.8",
      ips: ["2001:db8::10", "203.0.113.8"],
      trusted: true,
    },
  ])("checks immediate peer $peer for $configured", async (scenario) => {
    const app = Fastify({ trustProxy: parseTrustProxy(scenario.configured) });
    app.get("/identity", async (request) => ({
      ip: request.ip,
      ips: request.ips,
      hostname: request.hostname,
      protocol: request.protocol,
    }));
    try {
      const response = await app.inject({
        url: "/identity",
        remoteAddress: scenario.peer,
        headers: {
          host: "direct.test",
          "x-forwarded-for": "203.0.113.7, 203.0.113.8",
          "x-forwarded-host": "forwarded.test",
          "x-forwarded-proto": "https",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ip: scenario.ip,
        ...(scenario.ips ? { ips: scenario.ips } : {}),
        hostname: scenario.trusted ? "forwarded.test" : "direct.test",
        protocol: scenario.trusted ? "https" : "http",
      });
    } finally {
      await app.close();
    }
  });
});
