type ListenOptions = { host: string; port: number };

type ServerLike = {
  listen(options: ListenOptions): Promise<unknown>;
  close(): Promise<unknown>;
};

type LeaseLike = { release(): void };

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

export async function closeWithLeaseCleanup(
  app: Pick<ServerLike, "close">,
  lease: LeaseLike,
) {
  const result = await app.close();
  lease.release();
  return result;
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
