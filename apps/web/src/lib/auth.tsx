import { createContext, use, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoginInput, RegisterInput, User } from "@tathkara/shared";
import { api, ApiRequestError } from "./api";

type AuthValue = {
  user: User | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

async function fetchMe() {
  try {
    return (await api<{ user: User }>("/auth/me")).user;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 5 * 60_000 });
  const onSession = (user: User) => {
    qc.setQueryData(["me"], user);
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    return user;
  };
  const loginM = useMutation({
    mutationFn: (input: LoginInput) => api<{ user: User }>("/auth/login", { method: "POST", json: input }),
  });
  const registerM = useMutation({
    mutationFn: (input: RegisterInput) => api<{ user: User }>("/auth/register", { method: "POST", json: input }),
  });

  const value: AuthValue = {
    user: me.data ?? null,
    loading: me.isPending,
    login: async (input) => onSession((await loginM.mutateAsync(input)).user),
    register: async (input) => onSession((await registerM.mutateAsync(input)).user),
    logout: async () => {
      await api("/auth/logout", { method: "POST" });
      qc.setQueryData(["me"], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" && q.queryKey[0] !== "events" });
    },
  };
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>.");
  return ctx;
}
