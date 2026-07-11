export type OperationContext = {
  correlationId?: string;
  source?: string;
  action?: string;
  [key: string]: unknown;
};
