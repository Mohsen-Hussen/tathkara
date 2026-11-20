import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { CheckCircle2, Download } from "lucide-react";
import type { Ticket } from "@tathkara/shared";
import { api } from "../lib/api";
import { formatFull } from "../lib/format";
import { Card, Empty, ErrorNote, PageTitle, Spinner } from "../components/ui";

function Qr({ value }: { value: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    void QRCode.toDataURL(value, { margin: 1, width: 240 }).then(setSrc);
  }, [value]);
  return src ? (
    <img src={src} alt={`QR code for ticket ${value}`} className="size-28 rounded-lg" />
  ) : (
    <div className="size-28" />
  );
}

export function TicketsPage() {
  const tickets = useQuery({ queryKey: ["tickets"], queryFn: () => api<Ticket[]>("/tickets") });
  return (
    <>
      <PageTitle title="My tickets" description="Show the QR code at the entrance. Each code works once." />
      {tickets.isPending ? (
        <Spinner />
      ) : tickets.isError ? (
        <ErrorNote>{tickets.error.message}</ErrorNote>
      ) : tickets.data.length === 0 ? (
        <Empty title="No tickets yet">
          <Link to="/" className="font-medium text-amber-700 underline">
            Find an event
          </Link>
        </Empty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {tickets.data.map((t) => (
            <li key={t.id}>
              <Card className="flex gap-5 p-5">
                <Qr value={t.code} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{t.eventTitle}</p>
                  <p className="mt-0.5 text-sm text-muted">{formatFull(t.startsAt)}</p>
                  <p className="text-sm text-muted">{t.venue}</p>
                  <p className="mt-2 text-sm">
                    <span className="font-semibold">
                      Row {t.row}, seat {t.number}
                    </span>{" "}
                    · {t.section} · {t.tier}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted">{t.code}</p>
                  <div className="mt-3 flex items-center gap-4 text-sm">
                    {t.checkedInAt ? (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <CheckCircle2 aria-hidden className="size-4" /> Checked in
                      </span>
                    ) : (
                      <a
                        href={`/api/tickets/${t.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-amber-700 hover:underline"
                      >
                        <Download aria-hidden className="size-4" /> PDF
                      </a>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
