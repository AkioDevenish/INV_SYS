"use client";

import { useOnChange } from "@/lib/use-synced-state";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Modal } from "@/components/modal";
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/lib/roles";
import type { UserRow } from "@/lib/queries";
import {
  createUserAction,
  deleteUserAction,
  updateUserAction,
  type UserState,
} from "./actions";

function cryptoRandomIndex(max: number): number {
  if (max <= 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % max;
  }
}

function generateStrongPassword(): string {
  const letters = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const pick = (pool: string) => pool[cryptoRandomIndex(pool.length)]!;
  const chars = [
    pick(letters),
    pick(digits),
    ...Array.from({ length: 10 }, () => pick(all)),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = cryptoRandomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy textarea copy when Clipboard API is restricted.
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

function PasswordInputWithTools({
  id,
  name,
  label,
  required = false,
  placeholder,
  value: controlledValue,
  onValueChange,
}: {
  id: string;
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const [internalValue, setInternalValue] = useState("");
  const value = controlledValue ?? internalValue;
  const setValue = (next: string) => {
    if (onValueChange) onValueChange(next);
    else setInternalValue(next);
  };

  const [visible, setVisible] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleGenerate = () => {
    clearTimer();
    setValue(generateStrongPassword());
    setVisible(true);
    setCopyState("idle");
  };

  const handleCopy = async () => {
    if (!value) return;
    clearTimer();
    const ok = await copyToClipboard(value);
    setCopyState(ok ? "copied" : "failed");
    timerRef.current = setTimeout(() => setCopyState("idle"), 2000);
  };

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <div className="relative min-w-0 flex-1">
          <input
            id={id}
            name={name}
            type={visible ? "text" : "password"}
            required={required}
            minLength={value.length > 0 || required ? 8 : undefined}
            maxLength={256}
            autoComplete="new-password"
            value={value}
            onChange={(e) => {
              clearTimer();
              setValue(e.target.value);
              setCopyState("idle");
            }}
            className="field pr-9 font-mono text-xs"
            placeholder={placeholder}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-ink/50 hover:text-ink"
            aria-label={visible ? "Hide password" : "Show password"}
          >
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          className="btn btn-ghost shrink-0 px-3 py-2 text-xs"
          title="Generate a strong temporary password"
        >
          <RefreshCw size={13} /> Generate
        </button>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!value}
          className="btn btn-ghost shrink-0 px-3 py-2 text-xs"
          title="Copy password"
        >
          {copyState === "copied" ? (
            <Check size={13} className="text-emerald-700" />
          ) : (
            <Copy size={13} />
          )}
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending && <Loader2 size={15} className="animate-spin" />}
      {pending ? "Saving…" : label}
    </button>
  );
}

function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-700"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function RoleChooser({ defaultRole }: { defaultRole?: Role }) {
  const [role, setRole] = useState<Role>(defaultRole ?? "VIEWER");
  useOnChange(defaultRole, (next) => {
    if (next) setRole(next);
  });

  return (
    <fieldset>
      <legend className="label">Access level</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {ROLES.map((option) => (
          <label
            key={option}
            className={`cursor-pointer rounded-xl border p-3 transition focus-within:ring-2 focus-within:ring-iica-600/40 ${
              role === option
                ? "border-iica-700 bg-iica-50/70 ring-1 ring-iica-700/20"
                : "border-ink/10 bg-white hover:border-iica-300 hover:bg-iica-50/30"
            }`}
          >
            <input
              type="radio"
              name="role"
              value={option}
              checked={role === option}
              onChange={() => setRole(option)}
              className="sr-only"
            />
            <div className="text-sm font-semibold text-ink">{ROLE_LABELS[option]}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-ink/60">
              {ROLE_DESCRIPTIONS[option]}
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CreateUserForm({ onDone }: { onDone: () => void }) {
  const [state, action] = useActionState<UserState, FormData>(createUserAction, {});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  if (state.ok) {
    const handleCopyCredentials = async () => {
      const ok = await copyToClipboard(`Email: ${email.trim().toLowerCase()}\nTemporary password: ${password}`);
      setCopied(ok ? "copied" : "failed");
    };

    return (
      <div className="space-y-4">
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-emerald-600/30 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900"
        >
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-700" />
          <span>{state.message ?? "Account created."}</span>
        </div>

        <div className="space-y-2 rounded-xl border border-ink/10 bg-iica-50/45 p-3.5 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink/60">Email</span>
            <span className="font-mono font-medium text-ink">{email.trim().toLowerCase()}</span>
          </div>
          {password && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink/60">Temporary password</span>
              <span className="font-mono font-semibold text-ink">{password}</span>
            </div>
          )}
          <p className="pt-1 text-ink/60">
            They will be asked to choose their own password on first sign-in.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          {password && (
            <button type="button" onClick={handleCopyCredentials} className="btn btn-ghost">
              {copied === "copied" ? (
                <Check size={14} className="text-emerald-700" />
              ) : (
                <Copy size={14} />
              )}
              {copied === "copied"
                ? "Copied credentials"
                : copied === "failed"
                  ? "Copy failed"
                  : "Copy credentials"}
            </button>
          )}
          <button type="button" onClick={onDone} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <ErrorBanner message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="new-name">
            Full name
          </label>
          <input
            id="new-name"
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
            placeholder="Full name"
          />
        </div>
        <div>
          <label className="label" htmlFor="new-email">
            Email address
          </label>
          <input
            id="new-email"
            name="email"
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
            placeholder="name@iica.int"
          />
        </div>
      </div>
      <PasswordInputWithTools
        id="new-password"
        name="password"
        label="Temporary password"
        required
        value={password}
        onValueChange={setPassword}
        placeholder="At least 8 characters, with a letter and a number"
      />
      <RoleChooser />
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <Submit label="Create account" />
      </div>
    </form>
  );
}

export function NewUserButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <UserPlus size={15} /> Create user
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create an account"
        description="Set a temporary password and share it with the person directly."
      >
        <CreateUserForm onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function UpdateUserForm({
  user,
  isSelf = false,
  onDone,
  onSuccess,
}: {
  user: UserRow;
  isSelf?: boolean;
  onDone: () => void;
  onSuccess?: (message: string) => void;
}) {
  const [state, action] = useActionState<UserState, FormData>(updateUserAction, {});
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [status, setStatus] = useState<"ACTIVE" | "DISABLED">(user.status);
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  const callbacksRef = useRef({ onDone, onSuccess });
  useEffect(() => {
    callbacksRef.current = { onDone, onSuccess };
  }, [onDone, onSuccess]);

  // A different (or refreshed) account resets the form to its saved values.
  useOnChange(user, (next) => {
    setName(next.name);
    setEmail(next.email);
    setStatus(next.status);
    setPassword("");
    setCurrentPassword("");
  });

  useEffect(() => {
    if (state.ok) {
      if (state.message) callbacksRef.current.onSuccess?.(state.message);
      callbacksRef.current.onDone();
    }
  }, [state]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={user.id} />
      <ErrorBanner message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`name-${user.id}`}>
            Full name
          </label>
          <input
            id={`name-${user.id}`}
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor={`email-${user.id}`}>
            Email address
          </label>
          <input
            id={`email-${user.id}`}
            name="email"
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
          />
        </div>
      </div>

      <div className="space-y-3">
        <PasswordInputWithTools
          id={`password-${user.id}`}
          name="password"
          label="Reset password (leave blank to keep unchanged)"
          value={password}
          onValueChange={setPassword}
          placeholder="Enter or generate a new password"
        />
        {isSelf && password.length > 0 && (
          <div>
            <label className="label" htmlFor={`current-password-${user.id}`}>
              Current password (required to change your own password)
            </label>
            <input
              id={`current-password-${user.id}`}
              name="current_password"
              type="password"
              required
              maxLength={256}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter your current password"
              className="field"
            />
          </div>
        )}
        <p className="text-xs text-ink/60">
          {isSelf
            ? "Changing your own password requires your current password and refreshes your session."
            : "Setting a password signs the user out of existing sessions and prompts a password change."}
        </p>
      </div>

      <div>
        <label className="label" htmlFor={`status-${user.id}`}>
          Account status
        </label>
        <select
          id={`status-${user.id}`}
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value === "DISABLED" ? "DISABLED" : "ACTIVE")}
          className="field"
        >
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </div>

      <RoleChooser defaultRole={user.role} />

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <Submit label="Save changes" />
      </div>
    </form>
  );
}

export function RemoveUserForm({
  user,
  onDone,
  onSuccess,
}: {
  user: UserRow;
  onDone: () => void;
  onSuccess?: (message: string) => void;
}) {
  const [state, action] = useActionState<UserState, FormData>(deleteUserAction, {});
  const callbacksRef = useRef({ onDone, onSuccess });
  useEffect(() => {
    callbacksRef.current = { onDone, onSuccess };
  }, [onDone, onSuccess]);

  useEffect(() => {
    if (state.ok) {
      if (state.message) callbacksRef.current.onSuccess?.(state.message);
      callbacksRef.current.onDone();
    }
  }, [state]);

  return (
    <>
      <p className="mb-4 text-sm leading-relaxed text-ink/65">
        The account is deleted and can no longer sign in. Stock movements and audit logs they recorded remain intact. Disabling the account instead preserves attribution.
      </p>
      <ErrorBanner message={state.error} />
      <form action={action} className="flex justify-end gap-2">
        <input type="hidden" name="id" value={user.id} />
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <DeleteSubmit />
      </form>
    </>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-danger" disabled={pending}>
      {pending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
      Remove access
    </button>
  );
}
