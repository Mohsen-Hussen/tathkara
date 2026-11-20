import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, ScanLine, XCircle } from "lucide-react";
import clsx from "clsx";
import type { EventStats, EventSummary } from "@tathkara/shared";
import { api, ApiRequestError } from "../lib/api";
import { formatDate, formatSar } from "../lib/format";
import { Button, Card, ErrorNote, PageTitle, Spinner } from "../components/ui";

type CheckInResult = {
  eventTitle: string;
  holder: string;
  section: string;
  row: string;
  number: number;
  tier: string;
  checkedInAt: string;
};

export function OrganizerPage() {
  const events = useQuery({
    queryKey: ["organizer", "events"],
    queryFn: () => api<EventSummary[]>("/organizer/events"),
  });
  const [eventId, setEventId] = useState<string>();
  const active = eventId ?? events.data?.[0]?.id;
  const stats = useQuery({
    queryKey: ["organizer", "stats", active],
    queryFn: () => api<EventStats>(`/organizer/events/${active}/stats`),
    enabled: Boolean(active),
    refetchInterval: 5000,
  });

  if (events.isPending) return <Spinner />;
  if (events.isError) return <ErrorNote>{events.error.message}</ErrorNote>;

  return (
    <>
      <PageTitle title="Organizer" description="Live sales for your events, and the door scanner.">
        <label className="text-sm">
          <span className="sr-only">Event</span>
          <select
            value={active}
            onChange={(e) => setEventId(e.target.value)}
            className="h-10 rounded-xl border border-line bg-white px-3 text-sm"
          >
            {events.data.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} · {formatDate(e.startsAt)}
              </option>
            ))}
          </select>
        </label>
      </PageTitle>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {stats.data && <StatsView stats={stats.data} />}
          {stats.isPending && <Spinner />}
        </div>
        <CheckInCard />
      </div>
    </>
  );
}

function StatsView({ stats }: { stats: EventStats }) {
  const total = stats.sold + stats.held + stats.available;
  const cards = [
    { label: "Revenue", value: formatSar(stats.revenue) },
    { label: "Tickets sold", value: `${stats.sold} / ${total}` },
    { label: "Held right now", value: String(stats.held) },
    { label: "Checked in", value: `${stats.checkedIn} / ${stats.sold}` },
  ];
  const maxTier = Math.max(...stats.salesByTier.map((t) => t.revenue), 1);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Card key={c.label} className="p-5">
            <p className="text-sm text-muted">{c.label}</p>
            <p className="tabular mt-1 truncate text-2xl font-bold">{c.value}</p>
          </Card>
        ))}
      </div>
      <Card className="p-6">
        <h2 className="font-semibold">Seat map status</h2>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <div className="bg-ink" style={{ width: `${(stats.sold / total) * 100}%` }} />
          <div className="bg-amber-400" style={{ width: `${(stats.held / total) * 100}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted">
          {Math.round((stats.sold / total) * 100)}% sold · {stats.held} held · {stats.available} available
        </p>
        <h2 className="mt-8 font-semibold">Sales by tier</h2>
        <ul className="mt-4 space-y-3">
          {stats.salesByTier.map((t) => (
            <li key={t.tier} className="text-sm">
              <div className="flex justify-between">
                <span>{t.tier}</span>
                <span className="tabular text-muted">
                  {t.sold} sold · <span className="font-semibold text-ink">{formatSar(t.revenue)}</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-amber-500"
                  style={{ width: `${(t.revenue / maxTier) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
  }
}

function CheckInCard() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const checkIn = useMutation({
    mutationFn: (value: string) => api<CheckInResult>("/organizer/check-in", { method: "POST", json: { code: value } }),
    onSuccess: () => {
      setCode("");
      void qc.invalidateQueries({ queryKey: ["organizer", "stats"] });
    },
  });

  // Camera scanning where the browser supports the Barcode Detection API.
  useEffect(() => {
    if (!scanning || !window.BarcodeDetector) return;
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((s) => {
      stream = s;
      if (!video.current || stopped) return;
      video.current.srcObject = s;
      void video.current.play();
      const tick = async () => {
        if (stopped || !video.current) return;
        const [hit] = await detector.detect(video.current).catch(() => []);
        if (hit?.rawValue) {
          setScanning(false);
          checkIn.mutate(hit.rawValue);
          return;
        }
        raf = requestAnimationFrame(() => void tick());
      };
      void tick();
    });
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning]); // eslint-disable-line react-hooks/exhaustive-deps

  const err = checkIn.error instanceof ApiRequestError ? checkIn.error : null;

  return (
    <Card className="p-5 lg:sticky lg:top-24">
      <h2 className="flex items-center gap-2 font-semibold">
        <ScanLine aria-hidden className="size-5" /> Door check-in
      </h2>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) checkIn.mutate(code.trim());
        }}
      >
        <label htmlFor="code" className="sr-only">
          Ticket code
        </label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="TK-XXXX-XXXX-XXXX"
          autoComplete="off"
          className="h-10 min-w-0 flex-1 rounded-xl border border-line px-3 font-mono text-sm outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
        />
        <Button type="submit" loading={checkIn.isPending}>
          Admit
        </Button>
      </form>
      {window.BarcodeDetector && (
        <Button variant="secondary" className="mt-2 w-full" onClick={() => setScanning((s) => !s)}>
          <Camera aria-hidden className="size-4" /> {scanning ? "Stop camera" : "Scan with camera"}
        </Button>
      )}
      {scanning && (
        <video ref={video} muted playsInline className="mt-3 aspect-square w-full rounded-xl bg-black object-cover" />
      )}

      <div aria-live="polite" className="mt-4">
        {checkIn.data && !checkIn.isPending && (
          <Result
            ok
            title="Admitted"
            lines={[
              checkIn.data.holder,
              `${checkIn.data.section} · Row ${checkIn.data.row}, seat ${checkIn.data.number}`,
              checkIn.data.tier,
            ]}
          />
        )}
        {err && !checkIn.isPending && (
          <Result
            ok={false}
            title={
              err.code === "already_checked_in"
                ? "Already used"
                : err.code === "not_found"
                  ? "Not a valid ticket"
                  : "Can't admit"
            }
            lines={[err.message]}
          />
        )}
      </div>
    </Card>
  );
}

function Result({ ok, title, lines }: { ok: boolean; title: string; lines: string[] }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div
      className={clsx("rounded-xl p-4", ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900")}
      data-testid="check-in-result"
    >
      <p className="flex items-center gap-2 font-bold">
        <Icon aria-hidden className="size-5" /> {title}
      </p>
      {lines.map((l) => (
        <p key={l} className="mt-1 text-sm">
          {l}
        </p>
      ))}
    </div>
  );
}
