import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { LoginInput, RegisterInput } from "@tathkara/shared";
import { useAuth } from "../lib/auth";
import { ApiRequestError } from "../lib/api";
import { Logo } from "../components/layout";
import { Button, Card, ErrorNote, Field } from "../components/ui";

const DEMO = [
  { email: "ali@tathkara.app", label: "Ali — customer" },
  { email: "nora@tathkara.app", label: "Nora — organizer" },
];

/** Only same-site paths are allowed after sign-in (no open redirects). */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const schema = mode === "login" ? LoginInput : RegisterInput;
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      if (mode === "login") await login(parsed.data as LoginInput);
      else await register(parsed.data as RegisterInput);
      navigate(next, { replace: true });
    } catch (error) {
      setFormError(error instanceof ApiRequestError ? error.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  };

  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-8 text-center">
        <Logo />
        <h1 className="mt-6 text-2xl font-bold">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
      </div>
      <Card className="p-6">
        <form onSubmit={submit} noValidate className="space-y-4">
          {mode === "register" && (
            <Field
              label="Name"
              name="name"
              autoComplete="name"
              value={values.name}
              onChange={set("name")}
              error={errors.name}
            />
          )}
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={set("email")}
            error={errors.email}
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={values.password}
            onChange={set("password")}
            error={errors.password}
          />
          {formError && <ErrorNote>{formError}</ErrorNote>}
          <Button type="submit" className="w-full" size="lg" loading={pending}>
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
        {mode === "login" && (
          <div className="mt-6 border-t border-line pt-5">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Demo accounts · password demo1234</p>
            <div className="mt-2 grid gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => setValues({ name: "", email: d.email, password: "demo1234" })}
                  className="rounded-xl border border-line px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>
      <p className="mt-6 text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link to={`/register?next=${encodeURIComponent(next)}`} className="font-medium text-ink underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Have an account?{" "}
            <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-ink underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
