"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { completeSetupAction, type SetupState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? (
        <>
          <Loader2 size={16} className="animate-spin" /> Creating your account…
        </>
      ) : (
        <>
          Create administrator account <ArrowRight size={16} />
        </>
      )}
    </button>
  );
}

export function SetupForm({ requireSetupToken = false }: { requireSetupToken?: boolean }) {
  const [state, formAction] = useActionState<SetupState, FormData>(completeSetupAction, {});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupToken, setSetupToken] = useState("");

  const mismatch = confirm.length > 0 && password !== confirm;

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-700"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            {state.error}{" "}
            {state.alreadySetUp && (
              <Link href="/login" className="font-semibold underline underline-offset-2">
                Go to sign in
              </Link>
            )}
          </span>
        </div>
      )}

      {requireSetupToken && (
        <div>
          <label className="label" htmlFor="setup_token">
            Setup token
          </label>
          <input
            id="setup_token"
            name="setup_token"
            type="password"
            required
            autoComplete="off"
            value={setupToken}
            onChange={(e) => setSetupToken(e.target.value)}
            placeholder="Enter the deployment SETUP_TOKEN"
            className="field font-mono text-xs"
          />
          <p className="mt-1.5 text-xs text-ink/60">
            Required by this deployment&apos;s server configuration before creating the first admin.
          </p>
        </div>
      )}

      <div>
        <label className="label" htmlFor="name">
          Your full name
        </label>
        <input
          id="name"
          name="name"
          required
          maxLength={120}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="email">
          Your email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@iica.org"
          className="field"
        />
        <p className="mt-2 text-xs text-ink/55">This is what you will sign in with.</p>
      </div>

      <div>
        <label className="label" htmlFor="password">
          Choose a password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={256}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters, with a letter and a number"
          className="field"
        />
        <p className="mt-1.5 text-xs text-ink/55">
          At least 8 characters, including a letter and a number.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="confirm">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          maxLength={256}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Type it again"
          className="field"
          aria-invalid={mismatch || undefined}
        />
        {mismatch && (
          <p className="mt-1.5 text-xs text-rose-700">Passwords do not match yet.</p>
        )}
      </div>

      <SubmitButton />
    </form>
  );
}
