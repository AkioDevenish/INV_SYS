"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { forceChangePasswordAction, type ChangeState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? <Loader2 size={15} className="animate-spin" /> : null}
      {pending ? "Saving…" : "Set my password"}
      {!pending && <ArrowRight size={15} />}
    </button>
  );
}

export function ChangePasswordForm() {
  const [state, action] = useActionState<ChangeState, FormData>(forceChangePasswordAction, {});
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mismatch = confirm.length > 0 && password !== confirm;

  return (
    <form action={action} className="space-y-4">
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
        <label className="label" htmlFor="current">
          Temporary password
        </label>
        <input
          id="current"
          name="current"
          type="password"
          required
          maxLength={256}
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          New password
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
          Confirm new password
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
          className="field"
          aria-invalid={mismatch || undefined}
        />
        {mismatch && (
          <p className="mt-1.5 text-xs text-rose-700">New passwords do not match yet.</p>
        )}
      </div>

      <SubmitButton />
    </form>
  );
}
