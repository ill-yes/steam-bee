import type { OperationContext } from "../operation-context.js";

type StoredOperationContext = OperationContext & {
  expiresAt: number;
};

type AccountOperationStateOptions = {
  contextTtlMs?: number;
  now?: () => number;
};

const defaultContextTtlMs = 2 * 60_000;

export class AccountOperationState {
  private readonly contexts = new Map<string, StoredOperationContext>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly contextTtlMs: number;
  private readonly now: () => number;

  constructor(options: AccountOperationStateOptions = {}) {
    this.contextTtlMs = options.contextTtlMs ?? defaultContextTtlMs;
    this.now = options.now ?? Date.now;
  }

  run<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(accountId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(accountId, tail);
    void tail.finally(() => {
      if (this.queues.get(accountId) === tail) {
        this.queues.delete(accountId);
      }
    });
    return result;
  }

  remember(
    accountId: string,
    fallbackAction: string,
    context: OperationContext,
  ) {
    const action = context.action ?? fallbackAction;
    if (!context.correlationId && !context.source && !action) return;
    this.contexts.set(accountId, {
      ...context,
      action,
      expiresAt: this.now() + this.contextTtlMs,
    });
  }

  metadata(accountId: string): Record<string, unknown> {
    const context = this.contexts.get(accountId);
    if (!context) return {};
    if (context.expiresAt <= this.now()) {
      this.contexts.delete(accountId);
      return {};
    }
    const { expiresAt, ...metadata } = context;
    void expiresAt;
    return metadata;
  }

  clearContext(accountId: string) {
    this.contexts.delete(accountId);
  }

  async drain() {
    await Promise.allSettled(this.queues.values());
  }

  clearContexts() {
    this.contexts.clear();
  }
}
