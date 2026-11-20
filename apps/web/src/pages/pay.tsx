import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CreditCard, Lock } from "lucide-react";
import { api } from "../lib/api";
import { formatSar } from "../lib/format";
import { Button, ErrorNote, Spinner } from "../components/ui";

type Session = { amount: number; title: string; status: string; expiresAt: string; orderId: string };

/**
 * Stands in for a payment provider's hosted checkout page. It deliberately looks like a
 * different product: in a real integration this page lives on the provider's domain.
 */
export function PayPage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState("4242 4242 4242 4242");
  const session = useQuery({
    queryKey: ["pay", sessionId],
    queryFn: () => api<Session>(`/mock-pay/sessions/${sessionId}`),
  });
  const complete = useMutation({
    mutationFn: (outcome: "succeeded" | "failed") =>
      api<{ orderId: string }>(`/mock-pay/sessions/${sessionId}/complete`, { method: "POST", json: { outcome } }),
    onSuccess: ({ orderId }) => navigate(`/orders/${orderId}`, { replace: true }),
  });

  if (session.isPending) return <Spinner label="Opening checkout" />;
  if (session.isError) return <ErrorNote>{session.error.message}</ErrorNote>;
  const declines = card.replace(/\s/g, "") === "4000000000000002";

  return (
    <div className="mx-auto max-w-md">
      <div className="overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-slate-200">
        <div className="bg-gradient-to-br from-indigo-600 to-violet-600 px-6 py-5 text-white">
          <p className="flex items-center gap-2 text-sm font-semibold opacity-90">
            <Lock aria-hidden className="size-4" /> SandboxPay · test mode
          </p>
          <p className="mt-3 text-sm opacity-80">Pay Tathkara</p>
          <p className="tabular text-3xl font-bold">{formatSar(session.data.amount)}</p>
          <p className="mt-1 text-sm opacity-80">{session.data.title}</p>
        </div>
        <form
          className="space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            complete.mutate(declines ? "failed" : "succeeded");
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="card" className="text-sm font-medium">
              Card number
            </label>
            <div className="relative">
              <CreditCard aria-hidden className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input
                id="card"
                value={card}
                onChange={(e) => setCard(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                className="tabular h-11 w-full rounded-xl border border-slate-200 pr-3 pl-9 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
              />
            </div>
            <p className="text-xs text-slate-500">
              Test cards: <code>4242 4242 4242 4242</code> succeeds, <code>4000 0000 0000 0002</code> is declined.
            </p>
          </div>
          {complete.isError && <ErrorNote>{complete.error.message}</ErrorNote>}
          {session.data.status !== "pending" ? (
            <ErrorNote>This checkout is no longer active ({session.data.status}).</ErrorNote>
          ) : (
            <Button
              type="submit"
              size="lg"
              className="w-full bg-indigo-600 hover:bg-indigo-700"
              loading={complete.isPending}
            >
              Pay {formatSar(session.data.amount)}
            </Button>
          )}
          <p className="text-center text-xs text-slate-500">
            No real money moves. The result reaches Tathkara through a signed webhook.
          </p>
        </form>
      </div>
    </div>
  );
}
