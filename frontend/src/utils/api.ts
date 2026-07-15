const LOCAL_DEV_API_BASE = "http://localhost:8000";

export const API_BASE = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? LOCAL_DEV_API_BASE : "")
).replace(/\/$/, "");

type ApiErrorPayload = {
  error?: unknown;
  message?: unknown;
};

export class ApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  readonly status: number;

  constructor({
    status,
    message,
    code,
    details,
  }: {
    status: number;
    message: string;
    code?: string;
    details?: unknown;
  }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ApiFetchOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getErrorInfo(payload: unknown, fallbackMessage: string) {
  if (!isRecord(payload)) {
    return { message: fallbackMessage };
  }

  const envelope = payload as ApiErrorPayload;
  if (typeof envelope.error === "string") {
    return { message: envelope.error };
  }

  if (isRecord(envelope.error)) {
    return {
      message:
        typeof envelope.error.message === "string"
          ? envelope.error.message
          : fallbackMessage,
      code:
        typeof envelope.error.code === "string"
          ? envelope.error.code
          : undefined,
      details: envelope.error.details,
    };
  }

  return {
    message:
      typeof envelope.message === "string" ? envelope.message : fallbackMessage,
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  let body = options.body;

  if (isPlainObject(body)) {
    body = JSON.stringify(body);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  } else if (typeof body === "string" && !headers.has("Content-Type")) {
    const firstBodyChar = body.trimStart()[0];
    if (firstBodyChar === "{" || firstBodyChar === "[") {
      headers.set("Content-Type", "application/json");
    }
  }

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const response = await fetch(apiUrl(path), {
    ...options,
    body,
    credentials: "include",
    headers,
  });
  const responseBody = await readResponseBody(response);

  if (!response.ok) {
    // Keep the UI's auth state in sync with the server.  A session cookie can
    // expire while the user is already inside a wizard; without this signal
    // the page keeps rendering as if the user were signed in and every
    // protected action fails with a confusing 401 response.
    if (
      response.status === 401 &&
      !path.startsWith("/api/auth/login") &&
      !path.startsWith("/api/auth/register") &&
      !path.startsWith("/api/auth/me")
    ) {
      window.dispatchEvent(new Event("synapse:auth-expired"));
    }

    const error = getErrorInfo(
      responseBody,
      response.statusText || "Request failed",
    );
    throw new ApiError({ status: response.status, ...error });
  }

  return responseBody as T;
}
