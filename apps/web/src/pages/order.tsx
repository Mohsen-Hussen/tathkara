import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { Order } from "@tathkara/shared";
import { api } from "../lib/api";
import { formatSar } from "../lib/format";
import { Button, Card, ErrorNote, Spinner } from "../components/ui";

/** Waits for the webhook to settle the order; the browser never decides it was paid. */
export function OrderPage() {
  const { orderId = "" } = useParams();
  const order = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => api<Order>(`/orders/${orderId}`),
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 1000 : false),
  });
  if (order.isPending) return <Spinner label="Confirming your payment" />;
  if (order.isError) return <ErrorNote>{order.error.message}</ErrorNote>;
  const o = order.data;

  return (
    <Card className="mx-auto max-w-lg p-8 text-center">
      {o.status === "paid" ? (
        <>
          <CheckCircle2 aria-hidden className="mx-auto size-12 text-emerald-500" />
          <h1 className="mt-4 text-2xl font-bold">You're going!</h1>
          <p className="mt-2 text-muted">
            {o.seats.length} {o.seats.length === 1 ? "ticket" : "tickets"} for {o.eventTitle} · {formatSar(o.total)}
          </p>
          <p className="mt-1 text-sm text-muted">
            We're emailing your tickets as a PDF — they'll appear in your inbox in a moment.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link to="/tickets">
              <Button>View my tickets</Button>
            </Link>
            <Link to="/inbox">
              <Button variant="secondary">Open inbox</Button>
            </Link>
          </div>
        </>
      ) : o.status === "pending" ? (
        <>
          <Loader2 aria-hidden className="mx-auto size-10 animate-spin text-muted" />
          <h1 className="mt-4 text-xl font-bold">Confirming your payment…</h1>
          <p className="mt-2 text-sm text-muted">Waiting for the payment provider to confirm.</p>
        </>
      ) : (
        <>
          <XCircle aria-hidden className="mx-auto size-12 text-rose-500" />
          <h1 className="mt-4 text-2xl font-bold">
            {o.status === "failed"
              ? "Payment declined"
              : o.status === "expired"
                ? "Your hold expired"
                : "Order cancelled"}
          </h1>
          <p className="mt-2 text-muted">
            Your seats were released. {o.status === "expired" && "If you were charged, it has been refunded."}
          </p>
          <Link to="/" className="mt-6 inline-block">
            <Button>Back to events</Button>
          </Link>
        </>
      )}
    </Card>
  );
}
