export type ApiErrorPayload = {
  error?: unknown;
  message?: unknown;
  code?: unknown;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getErrorInfo(payload: unknown, fallbackMessage: string) {
  if (!isRecord(payload)) {
    return { message: fallbackMessage };
  }

  const envelope = payload as ApiErrorPayload;
  const code = typeof envelope.code === 'string' ? envelope.code : undefined;
  if (typeof envelope.error === 'string') {
    return { message: envelope.error, code };
  }

  if (isRecord(envelope.error)) {
    return {
      message:
        typeof envelope.error.message === 'string'
          ? envelope.error.message
          : fallbackMessage,
      code:
        typeof envelope.error.code === 'string'
          ? envelope.error.code
          : code,
      details: envelope.error.details,
    };
  }

  return {
    message:
      typeof envelope.message === 'string' ? envelope.message : fallbackMessage,
    code,
  };
}
