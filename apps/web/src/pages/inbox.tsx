import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import clsx from "clsx";
import type { InboxMessage } from "@tathkara/shared";
import { api } from "../lib/api";
import { Card, Empty, ErrorNote, PageTitle, Spinner } from "../components/ui";

const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function InboxPage() {
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api<InboxMessage[]>("/inbox"), refetchInterval: 5000 });
  const [openId, setOpenId] = useState<string | null>(null);
  const open = inbox.data?.find((m) => m.id === (openId ?? inbox.data[0]?.id));

  return (
    <>
      <PageTitle
        title="Inbox"
        description="A demo mailbox: emails the app sends you (like your tickets) land here instead of a real inbox."
      />
      {inbox.isPending ? (
        <Spinner />
      ) : inbox.isError ? (
        <ErrorNote>{inbox.error.message}</ErrorNote>
      ) : !inbox.data.length ? (
        <Empty title="No emails yet">Buy a ticket and it'll arrive here within a few seconds.</Empty>
      ) : (
        <Card className="grid overflow-hidden md:grid-cols-[18rem_1fr]">
          <ul className="divide-y divide-line border-b border-line md:border-r md:border-b-0">
            {inbox.data.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(m.id)}
                  aria-current={open?.id === m.id}
                  className={clsx(
                    "w-full px-4 py-3 text-left text-sm hover:bg-slate-50",
                    open?.id === m.id && "bg-amber-50",
                  )}
                >
                  <span className="line-clamp-1 font-semibold">{m.subject}</span>
                  <span className="text-xs text-muted">{WHEN.format(new Date(m.createdAt))}</span>
                </button>
              </li>
            ))}
          </ul>
          {open && (
            <article className="p-6">
              <h2 className="text-lg font-bold">{open.subject}</h2>
              <p className="text-xs text-muted">From Tathkara · {WHEN.format(new Date(open.createdAt))}</p>
              <p className="mt-5 text-sm leading-relaxed whitespace-pre-line">{open.body}</p>
              {open.attachment && (
                <a
                  href={open.attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-6 inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-medium hover:bg-slate-50"
                >
                  <Paperclip aria-hidden className="size-4" /> {open.attachment.name}
                </a>
              )}
            </article>
          )}
        </Card>
      )}
    </>
  );
}
