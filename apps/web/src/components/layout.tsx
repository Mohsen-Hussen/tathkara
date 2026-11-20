import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Ticket } from "lucide-react";
import clsx from "clsx";
import type { InboxMessage } from "@tathkara/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 text-lg font-bold tracking-tight">
      <span className="grid size-8 place-items-center rounded-lg bg-ink text-amber-400">
        <Ticket aria-hidden className="size-4.5" />
      </span>
      tathkara
    </span>
  );
}

const link = ({ isActive }: { isActive: boolean }) =>
  clsx("rounded-lg px-3 py-2 text-sm font-medium", isActive ? "bg-slate-100 text-ink" : "text-muted hover:text-ink");

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const inbox = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api<InboxMessage[]>("/inbox"),
    enabled: Boolean(user),
    refetchInterval: 10_000,
  });

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link to="/" className="mr-4">
            <Logo />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 overflow-x-auto">
            <NavLink to="/" end className={link}>
              Events
            </NavLink>
            {user && (
              <>
                <NavLink to="/tickets" className={link}>
                  My tickets
                </NavLink>
                <NavLink to="/inbox" className={link}>
                  Inbox
                  {!!inbox.data?.length && (
                    <span className="tabular ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      {inbox.data.length}
                    </span>
                  )}
                </NavLink>
              </>
            )}
            {user?.role === "organizer" && (
              <NavLink to="/organizer" className={link}>
                Organizer
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <>
                <span className="hidden text-sm text-muted sm:inline">{user.name}</span>
                <button
                  type="button"
                  aria-label="Sign out"
                  title="Sign out"
                  onClick={async () => {
                    await logout();
                    navigate("/");
                  }}
                  className="rounded-lg p-2 text-muted hover:bg-slate-100 hover:text-ink"
                >
                  <LogOut className="size-4" />
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        Demo project · payments use a built-in sandbox, no real cards ·{" "}
        <a href="/api/docs" className="underline hover:text-ink">
          API docs
        </a>
      </footer>
    </div>
  );
}
