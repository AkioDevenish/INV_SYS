"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { loginAction, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? (
        <>
          <Loader2 size={16} className="animate-spin" /> Signing in…
        </>
      ) : (
        <>
          Sign in <ArrowRight size={16} />
        </>
      )}
    </button>
  );
}

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});
  // Controlled so a rejected sign-in does not wipe what was typed.
  const [email, setEmail] = useState("");

  return (
    <form action={formAction} className="space-y-4">
      {nextPath && <input type="hidden" name="next" value={nextPath} />}
      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-700"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <div>
        <label className="label" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@iica.org"
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className="field"
        />
      </div>

      <SubmitButton />
    </form>
  );
}
