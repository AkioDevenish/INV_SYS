"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import {
  changePasswordAction,
  updateProfileAction,
  type ProfileState,
} from "./actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending && <Loader2 size={15} className="animate-spin" />}
      {pending ? "Saving…" : label}
    </button>
  );
}

function Banner({ state }: { state: ProfileState }) {
  if (state.error) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-700"
      >
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <span>{state.error}</span>
      </div>
    );
  }
  if (state.message) {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-xl border border-iica-600/30 bg-iica-600/10 px-3 py-2.5 text-sm text-iica-800"
      >
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        <span>{state.message}</span>
      </div>
    );
  }
  return null;
}

export function DetailsForm({ name: initialName, email }: { name: string; email: string }) {
  const [state, action] = useActionState<ProfileState, FormData>(updateProfileAction, {});
  const [name, setName] = useState(initialName);

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  return (
    <form action={action} className="space-y-4">
      <Banner state={state} />
      <div>
        <label className="label" htmlFor="profile-name">
          Full name
        </label>
        <input
          id="profile-name"
          name="name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="profile-email">
          Email address
        </label>
        <input id="profile-email" value={email} disabled className="field" />
        <p className="mt-2 text-xs text-ink/55">
          Only an administrator can change the email address on an account.
        </p>
      </div>
      <div className="flex justify-end">
        <Submit label="Save details" />
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState<ProfileState, FormData>(changePasswordAction, {});
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (state.message) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }, [state]);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  return (
    <form action={action} className="space-y-4">
      <Banner state={state} />
      <div>
        <label className="label" htmlFor="current_password">
          Current password
        </label>
        <input
          id="current_password"
          name="current_password"
          type="password"
          required
          maxLength={256}
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="field"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="new_password">
            New password
          </label>
          <input
            id="new_password"
            name="new_password"
            type="password"
            required
            minLength={8}
            maxLength={256}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm_password">
            Confirm new password
          </label>
          <input
            id="confirm_password"
            name="confirm_password"
            type="password"
            required
            minLength={8}
            maxLength={256}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="field"
            aria-invalid={mismatch || undefined}
          />
          {mismatch && (
            <p className="mt-1 text-xs text-rose-700">New passwords do not match yet.</p>
          )}
        </div>
      </div>
      <p className="text-xs text-ink/55">
        At least 8 characters, including a letter and a number.
      </p>
      <div className="flex justify-end">
        <Submit label="Change password" />
      </div>
    </form>
  );
}
