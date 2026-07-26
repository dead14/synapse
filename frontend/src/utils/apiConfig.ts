const LOCAL_DEV_API_BASE = "http://localhost:8000";

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function resolveApiBase(
  configuredBase: string | undefined,
  isDevelopment: boolean,
): string {
  const candidate = configuredBase?.trim();

  if (!candidate) {
    return isDevelopment ? LOCAL_DEV_API_BASE : "";
  }

  if (!isDevelopment && isLoopbackUrl(candidate)) {
    return "";
  }

  return candidate.replace(/\/$/, "");
}
