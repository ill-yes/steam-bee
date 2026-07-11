import type { FastifyRequest } from "fastify";
import type { OperationContext } from "../operation-context.js";

export type { OperationContext } from "../operation-context.js";

export function operationContext(
  request: FastifyRequest,
  action: string,
): OperationContext {
  return {
    correlationId: request.id,
    source: "api",
    action,
  };
}
