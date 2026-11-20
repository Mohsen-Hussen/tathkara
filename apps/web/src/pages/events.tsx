import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, MapPin } from "lucide-react";
import type { EventSummary } from "@tathkara/shared";
import { api } from "../lib/api";
import { formatDate, formatSar, formatTime } from "../lib/format";
import { Card, ErrorNote, PageTitle, Spinner } from "../components/ui";

export function EventsPage() {
  const events = useQuery({ queryKey: ["events"], queryFn: () => api<EventSummary[]>("/events") });
  return (
    <>
      <PageTitle
        title="Upcoming events"
        description="Pick your exact seats on a live map. Held seats are yours for 10 minutes."
      />
      {events.isPending ? (
        <Spinner label="Loading events" />
      ) : events.isError ? (
        <ErrorNote>{events.error.message}</ErrorNote>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {events.data.map((e) => {
            const soldPct = Math.round(((e.totalSeats - e.seatsLeft) / e.totalSeats) * 100);
            return (
              <li key={e.id}>
                <Link to={`/events/${e.slug}`} className="group block h-full">
                  <Card className="flex h-full flex-col overflow-hidden transition-shadow group-hover:shadow-lg">
                    <div className="relative h-36 overflow-hidden" style={{ backgroundColor: e.accent }}>
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgb(255_255_255/0.35),transparent_45%)]" />
                      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 p-4 opacity-40" aria-hidden>
                        {Array.from({ length: 14 }, (_, i) => (
                          <span
                            key={i}
                            className="h-3 w-3 rounded-sm bg-white"
                            style={{ opacity: i % 3 === 0 ? 0.4 : 1 }}
                          />
                        ))}
                      </div>
                      <span className="absolute top-4 left-4 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold">
                        {e.category}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <h2 className="text-lg leading-snug font-bold">{e.title}</h2>
                      <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
                        <CalendarDays aria-hidden className="size-4" />
                        {formatDate(e.startsAt)} · {formatTime(e.startsAt)}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                        <MapPin aria-hidden className="size-4" />
                        {e.venue}, {e.city}
                      </p>
                      <div className="mt-auto pt-5">
                        <div className="mb-1.5 flex justify-between text-xs text-muted">
                          <span>{e.seatsLeft} seats left</span>
                          <span>{soldPct}% sold</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100" aria-hidden>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${soldPct}%`, backgroundColor: e.accent }}
                          />
                        </div>
                        <p className="mt-4 text-sm">
                          From <span className="tabular font-bold">{formatSar(e.fromPrice)}</span>
                        </p>
                      </div>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
