/* oxlint-disable react(only-export-components) -- provider and its hook are a single public context API. */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../utils/api";
import { disconnectSocket } from "../utils/socket";

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  orgId?: number;
  orgName?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (orgName: string, username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extractUser(response: unknown): User {
  if (!isRecord(response)) {
    throw new Error("Authentication response did not include a user.");
  }

  const nestedData = isRecord(response.data) ? response.data : undefined;
  const candidate = isRecord(response.user)
    ? response.user
    : isRecord(nestedData?.user)
      ? nestedData.user
      : nestedData || response;

  const id = asNumber(candidate.id);
  const username = typeof candidate.username === "string" ? candidate.username : undefined;
  const email = typeof candidate.email === "string" ? candidate.email : undefined;
  const role = typeof candidate.role === "string" ? candidate.role : undefined;

  if (id === undefined || !username || !email || !role) {
    throw new Error("Authentication response did not include a complete user.");
  }

  return {
    id,
    username,
    email,
    role,
    orgId: asNumber(
      candidate.orgId ?? candidate.organizationId ?? candidate.organization_id,
    ),
    orgName:
      typeof candidate.orgName === "string"
        ? candidate.orgName
        : typeof candidate.organizationName === "string"
          ? candidate.organizationName
          : typeof candidate.org_name === "string"
            ? candidate.org_name
            : undefined,
  };
}

function clearLegacyAuthStorage() {
  localStorage.removeItem("synapse_token");
  localStorage.removeItem("synapse_user");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    const handleAuthExpired = () => {
      if (!isCurrent) return;
      disconnectSocket();
      setUser(null);
    };

    window.addEventListener("synapse:auth-expired", handleAuthExpired);

    clearLegacyAuthStorage();
    setIsLoading(true);

    void apiFetch<unknown>("/api/auth/me", { signal: controller.signal })
      .then((response) => {
        if (isCurrent) setUser(extractUser(response));
      })
      .catch(() => {
        if (isCurrent) setUser(null);
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
      window.removeEventListener("synapse:auth-expired", handleAuthExpired);
    };
  }, []);

  const authenticate = async (
    path: "/api/auth/login" | "/api/auth/register",
    body: Record<string, string>,
  ) => {
    setIsLoading(true);
    try {
      const response = await apiFetch<unknown>(path, { method: "POST", body });

      try {
        setUser(extractUser(response));
      } catch {
        const session = await apiFetch<unknown>("/api/auth/me");
        setUser(extractUser(session));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    await authenticate("/api/auth/login", { email, password });
  };

  const register = async (orgName: string, username: string, email: string, password: string) => {
    await authenticate("/api/auth/register", { orgName, username, email, password });
  };

  const logout = () => {
    clearLegacyAuthStorage();
    disconnectSocket();
    setUser(null);
    void apiFetch<unknown>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// oxlint-disable-next-line react(only-export-components) -- exported alongside its provider as one context API.
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
