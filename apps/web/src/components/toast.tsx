import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

type Tone = "success" | "error" | "info";
type Toast = { id: number; message: string; tone: Tone };
const ToastContext = createContext<((message: string, tone?: Tone) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string, tone: Tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const value = useMemo(() => show, [show]);
  const Icon = { success: CheckCircle2, error: XCircle, info: Info };
  return (
    <ToastContext value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => {
          const I = Icon[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex max-w-md items-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-xl"
            >
              <I
                aria-hidden
                className={`size-4 shrink-0 ${t.tone === "error" ? "text-rose-400" : t.tone === "info" ? "text-sky-300" : "text-emerald-400"}`}
              />
              {t.message}
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const ctx = use(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>.");
  return ctx;
}
