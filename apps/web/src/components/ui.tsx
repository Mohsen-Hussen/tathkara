import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        {
          primary: "bg-ink text-white hover:bg-slate-800",
          secondary: "border border-line bg-white hover:bg-slate-50",
          ghost: "hover:bg-slate-100",
          danger: "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
        }[variant],
        { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" }[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={clsx("rounded-2xl border border-line bg-white", className)} {...props} />;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Loader2 aria-hidden className="size-5 animate-spin" />
      {label}…
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
      {children}
    </p>
  );
}

export function PageTitle({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="px-6 py-14 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </Card>
  );
}

export function Field({ label, error, ...props }: ComponentProps<"input"> & { label: string; error?: string }) {
  const id = props.id ?? props.name;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-11 w-full rounded-xl border border-line bg-white px-3.5 outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-100 aria-[invalid=true]:border-rose-400"
        {...props}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
