import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter";
import "./index.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { ApiRequestError } from "./lib/api";
import { ToastProvider } from "./components/toast";
import { Layout } from "./components/layout";
import { Spinner } from "./components/ui";
import { EventsPage } from "./pages/events";
import { EventPage } from "./pages/event";
import { PayPage } from "./pages/pay";
import { OrderPage } from "./pages/order";
import { TicketsPage } from "./pages/tickets";
import { InboxPage } from "./pages/inbox";
import { OrganizerPage } from "./pages/organizer";
import { AuthPage } from "./pages/auth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500) && count < 2,
    },
  },
});

function RequireAuth({ children, role }: { children: ReactNode; role?: "organizer" }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<EventsPage />} />
                <Route path="events/:slug" element={<EventPage />} />
                <Route
                  path="pay/:sessionId"
                  element={
                    <RequireAuth>
                      <PayPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="orders/:orderId"
                  element={
                    <RequireAuth>
                      <OrderPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="tickets"
                  element={
                    <RequireAuth>
                      <TicketsPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="inbox"
                  element={
                    <RequireAuth>
                      <InboxPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="organizer"
                  element={
                    <RequireAuth role="organizer">
                      <OrganizerPage />
                    </RequireAuth>
                  }
                />
                <Route path="login" element={<AuthPage mode="login" />} />
                <Route path="register" element={<AuthPage mode="register" />} />
                <Route path="*" element={<p className="py-20 text-center text-muted">Page not found.</p>} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
