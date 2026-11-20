import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, Clock, MapPin, Radio, X } from "lucide-react";
import { MAX_SEATS_PER_ORDER, type EventDetail, type Order, type Seat, type SeatChange } from "@tathkara/shared";
import { api, ApiRequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getSocket } from "../lib/socket";
import { formatCountdown, formatFull, formatSar } from "../lib/format";
import { Button, Card, ErrorNote, Spinner } from "../components/ui";
import { SeatLegend, SeatMap } from "../components/seat-map";
import { useToast } from "../components/toast";

function useCountdown(until: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [until]);
  return until ? new Date(until).getTime() - now : 0;
}

/** Applies live seat updates from the server to the cached event. */
function useLiveSeats(event: EventDetail | undefined, onTaken: (ids: string[]) => void) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!event) return;
    const socket = getSocket();
    const join = () => {
      setConnected(true);
      socket.emit("event:join", event.id);
    };
    const onChanged = ({ eventId, seats }: { eventId: string; seats: SeatChange[] }) => {
      if (eventId !== event.id) return;
      const byId = new Map(seats.map((s) => [s.id, s.status]));
      qc.setQueryData<EventDetail>(["event", event.slug], (old) => {
        if (!old) return old;
        const next = old.seats.map((s) =>
          byId.has(s.id) ? { ...s, status: byId.get(s.id)!, mine: s.mine && byId.get(s.id) !== "available" } : s,
        );
        return { ...old, seats: next, seatsLeft: next.filter((s) => s.status === "available").length };
      });
      onTaken(seats.filter((s) => s.status !== "available").map((s) => s.id));
    };
    if (socket.connected) join();
    socket.on("connect", join);
    socket.on("disconnect", () => setConnected(false));
    socket.on("seats:changed", onChanged);
    return () => {
      socket.emit("event:leave", event.id);
      socket.off("connect", join);
      socket.off("seats:changed", onChanged);
    };
  }, [event?.id, event?.slug, qc, onTaken]); // eslint-disable-line react-hooks/exhaustive-deps
  return connected;
}

export function EventPage() {
  const { slug = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Seats we're holding right now: their "held" broadcast is our own, not a lost race.
  const submitting = useRef<Set<string>>(new Set());

  const event = useQuery({ queryKey: ["event", slug], queryFn: () => api<EventDetail>(`/events/${slug}`) });
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<Order[]>("/orders"), enabled: Boolean(user) });
  const hold = orders.data?.find((o) => o.eventId === event.data?.id && o.status === "pending");
  const remaining = useCountdown(hold?.expiresAt);
  const expired = Boolean(hold) && remaining <= 0;

  const onTaken = useCallback(
    (ids: string[]) => {
      setSelected((prev) => {
        const lost = ids.filter((id) => prev.has(id) && !submitting.current.has(id));
        if (!lost.length) return prev;
        toast(
          `${lost.length === 1 ? "A seat you picked was" : "Some seats you picked were"} just taken by someone else.`,
          "info",
        );
        const next = new Set(prev);
        lost.forEach((id) => next.delete(id));
        return next;
      });
    },
    [toast],
  );
  const live = useLiveSeats(event.data, onTaken);

  useEffect(() => {
    if (expired) {
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["event", slug] });
    }
  }, [expired, qc, slug]);

  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["orders"] }), qc.invalidateQueries({ queryKey: ["event", slug] })]);

  const holdM = useMutation({
    mutationFn: (seatIds: string[]) => {
      submitting.current = new Set(seatIds);
      return api<Order>(`/events/${event.data!.id}/holds`, { method: "POST", json: { seatIds } });
    },
    onSettled: () => {
      submitting.current = new Set();
    },
    onSuccess: async () => {
      setSelected(new Set());
      await refresh();
      toast("Seats held for 10 minutes.");
    },
    onError: async (error) => {
      if (error instanceof ApiRequestError && error.code === "seats_unavailable") {
        const taken = (error.details as { seatIds?: string[] })?.seatIds ?? [];
        setSelected((prev) => new Set([...prev].filter((id) => !taken.includes(id))));
        await refresh();
      }
      toast(error.message, "error");
    },
  });
  const releaseM = useMutation({
    mutationFn: (orderId: string) => api(`/orders/${orderId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const payM = useMutation({
    mutationFn: (orderId: string) => api<{ url: string }>(`/orders/${orderId}/checkout`, { method: "POST" }),
    onSuccess: ({ url }) => navigate(url),
    onError: (error) => toast(error.message, "error"),
  });

  const toggle = useCallback(
    (seat: Seat) => {
      if (!user) {
        navigate(`/login?next=/events/${slug}`);
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(seat.id)) next.delete(seat.id);
        else if (next.size >= MAX_SEATS_PER_ORDER) toast(`You can pick up to ${MAX_SEATS_PER_ORDER} seats.`, "info");
        else next.add(seat.id);
        return next;
      });
    },
    [user, navigate, slug, toast],
  );

  const picked = useMemo(() => event.data?.seats.filter((s) => selected.has(s.id)) ?? [], [event.data, selected]);

  if (event.isPending) return <Spinner label="Loading seats" />;
  if (event.isError) return <ErrorNote>{event.error.message}</ErrorNote>;
  const e = event.data;

  return (
    <>
      <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> All events
      </Link>
      <div className="mb-8">
        <p className="text-sm font-semibold" style={{ color: e.accent }}>
          {e.category}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{e.title}</h1>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <span className="flex items-center gap-1.5">
            <CalendarDays aria-hidden className="size-4" /> {formatFull(e.startsAt)}
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin aria-hidden className="size-4" /> {e.venue}, {e.city}
          </span>
        </div>
        <p className="mt-4 max-w-2xl text-slate-600">{e.description}</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="p-5 sm:p-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <SeatLegend seats={e.seats} />
            <span role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
              <Radio aria-hidden className={`size-3.5 ${live ? "text-emerald-500" : "text-slate-400"}`} />
              {live ? "Live" : "Connecting…"} · {e.seatsLeft} left
            </span>
          </div>
          <SeatMap seats={e.seats} selected={selected} onToggle={toggle} disabled={Boolean(hold) && !expired} />
        </Card>

        <aside className="lg:sticky lg:top-24">
          {hold && !expired ? (
            <Card className="overflow-hidden" data-testid="hold-panel">
              <div className="flex items-center justify-between bg-amber-50 px-5 py-3 text-sm text-amber-900">
                <span className="flex items-center gap-1.5 font-medium">
                  <Clock aria-hidden className="size-4" /> Seats held for you
                </span>
                <span className="tabular font-bold" aria-label="Time left">
                  {formatCountdown(remaining)}
                </span>
              </div>
              <div className="p-5">
                <SeatList seats={hold.seats} />
                <Total amount={hold.total} />
                <Button className="mt-5 w-full" size="lg" loading={payM.isPending} onClick={() => payM.mutate(hold.id)}>
                  Pay {formatSar(hold.total)}
                </Button>
                <Button
                  variant="ghost"
                  className="mt-2 w-full"
                  loading={releaseM.isPending}
                  onClick={() => releaseM.mutate(hold.id)}
                >
                  Release seats
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="p-5">
              <h2 className="font-semibold">Your selection</h2>
              {picked.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  {user ? "Tap seats on the map to pick them." : "Sign in, then tap seats on the map to pick them."}
                </p>
              ) : (
                <>
                  <SeatList
                    seats={picked}
                    onRemove={(id) => setSelected((p) => new Set([...p].filter((x) => x !== id)))}
                  />
                  <Total amount={picked.reduce((s, x) => s + x.price, 0)} />
                </>
              )}
              <Button
                className="mt-5 w-full"
                size="lg"
                disabled={!picked.length}
                loading={holdM.isPending}
                onClick={() => (user ? holdM.mutate(picked.map((s) => s.id)) : navigate(`/login?next=/events/${slug}`))}
              >
                {picked.length ? `Hold ${picked.length} ${picked.length === 1 ? "seat" : "seats"}` : "Pick seats"}
              </Button>
              <p className="mt-3 text-center text-xs text-muted">
                Held seats are reserved for 10 minutes while you pay.
              </p>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

function SeatList({
  seats,
  onRemove,
}: {
  seats: Pick<Seat, "id" | "section" | "row" | "number" | "tier" | "price">[];
  onRemove?: (id: string) => void;
}) {
  return (
    <ul className="mt-3 divide-y divide-line text-sm">
      {seats.map((s) => (
        <li key={s.id} className="flex items-center gap-2 py-2">
          <span className="flex-1">
            Row {s.row}, seat {s.number}
            <span className="block text-xs text-muted">
              {s.section} · {s.tier}
            </span>
          </span>
          <span className="tabular font-medium">{formatSar(s.price)}</span>
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove row ${s.row} seat ${s.number}`}
              onClick={() => onRemove(s.id)}
              className="rounded-md p-1 text-muted hover:bg-slate-100 hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Total({ amount }: { amount: number }) {
  return (
    <div className="mt-3 flex justify-between border-t border-line pt-3 font-semibold">
      <span>Total</span>
      <span className="tabular" data-testid="total">
        {formatSar(amount)}
      </span>
    </div>
  );
}
