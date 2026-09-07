type ListenOptions = { host: string; port: number };

type ServerLike = {
  listen(options: ListenOptions): Promise<unknown>;
  close(): Promise<unknown>;
};

type LeaseLike = { release(): void };
export const shutdownBudgetMs = 25_000;

export class ShutdownTimeoutError extends Error {
  constructor() {
    super(
      "Runtime shutdown exceeded its deadline; retaining the data lease until process exit.",
    );
    this.name = "ShutdownTimeoutError";
  }
}

const closeOperations = new WeakMap<object, Promise<unknown>>();

export class IncompleteStartupCleanupError extends Error {
  readonly initializationError: unknown;
  readonly cleanupError: unknown;

  constructor(initializationError: unknown, cleanupError: unknown) {
    super("Server initialization failed and partial runtime cleanup failed.");
    this.name = "IncompleteStartupCleanupError";
    this.initializationError = initializationError;
    this.cleanupError = cleanupError;
  }
}

export class IncompleteListenCleanupError extends Error {
  readonly listenError: unknown;
  readonly cleanupError: unknown;

  constructor(listenError: unknown, cleanupError: unknown) {
    super("Server listen failed and runtime cleanup also failed.");
    this.name = "IncompleteListenCleanupError";
    this.listenError = listenError;
    this.cleanupError = cleanupError;
  }
}

export async function buildWithLeaseCleanup<T>(
  build: () => Promise<T>,
  lease: LeaseLike,
) {
  try {
    return await build();
  } catch (error) {
    if (!(error instanceof IncompleteStartupCleanupError)) lease.release();
    throw error;
  }
}

export function closeWithLeaseCleanup(
  app: Pick<ServerLike, "close">,
  lease: LeaseLike,
  timeoutMs = shutdownBudgetMs,
) {
  const existing = closeOperations.get(app);
  if (existing) return existing;
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ShutdownTimeoutError()), timeoutMs);
  });
  let runtimeClose: Promise<unknown>;
  try {
    runtimeClose = app.close();
  } catch (error) {
    runtimeClose = Promise.reject(error);
  }
  const closing = Promise.race([runtimeClose, deadline])
    .then((result) => {
      lease.release();
      return result;
    })
    .finally(() => clearTimeout(timer));
  closeOperations.set(app, closing);
  return closing;
}

export function createRuntimeShutdown(
  app: Pick<ServerLike, "close">,
  lease: LeaseLike,
  onFailure: (error: unknown) => void,
  exit: (code: number) => void,
  beginShutdown: () => void = () => undefined,
) {
  let closing: Promise<void> | undefined;
  return () => {
    if (closing) return closing;
    let cleanup: Promise<unknown>;
    try {
      beginShutdown();
      cleanup = closeWithLeaseCleanup(app, lease);
    } catch (error) {
      cleanup = Promise.reject(error);
    }
    closing = cleanup.then(
      () => exit(0),
      (error) => {
        try {
          onFailure(error);
        } finally {
          exit(1);
        }
      },
    );
    return closing;
  };
}

export async function listenWithLeaseCleanup(
  app: ServerLike,
  lease: LeaseLike,
  options: ListenOptions,
) {
  try {
    return await app.listen(options);
  } catch (listenError) {
    try {
      await closeWithLeaseCleanup(app, lease);
    } catch (cleanupError) {
      throw new IncompleteListenCleanupError(listenError, cleanupError);
    }
    throw listenError;
  }
}
