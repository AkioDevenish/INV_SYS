"use client";

import Link from "next/link";
import { FilterSelect } from "@/components/filter-select";
import { useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  Clock,
  KeyRound,
  LayoutGrid,
  Mail,
  Pencil,
  Search,
  ShieldCheck,
  Table2,
  Trash2,
  UserCheck,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { Modal } from "@/components/modal";
import { RoleBadge } from "@/components/role-badge";
import { formatDate, initials, relativeTime, type Timestamp } from "@/lib/format";
import { PERMISSION_COPY } from "@/lib/permission-copy";
import type { UserRow } from "@/lib/queries";
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type PermissionMatrix, type Role } from "@/lib/roles";
import { RemoveUserForm, UpdateUserForm } from "./user-forms";

type UserWithTempFlag = UserRow & { must_change_password?: boolean };

function toAstDateTime(value: Timestamp | null | undefined): string {
  if (!value) return "Never";
  const d =
    value instanceof Date
      ? value
      : new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Port_of_Spain",
  })} AST`;
}

export function UsersView({
  users,
  currentUserId,
  matrix,
}: {
  users: UserWithTempFlag[];
  currentUserId: number;
  matrix: PermissionMatrix;
}) {
  const [roleFilter, setRoleFilter] = useState<"ALL" | Role>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "DISABLED">("ALL");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [editingUser, setEditingUser] = useState<UserWithTempFlag | null>(null);
  const [removingUser, setRemovingUser] = useState<UserWithTempFlag | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const roleUserCounts = useMemo(() => {
    const counts: Partial<Record<Role, number>> = {};
    for (const r of ROLES) counts[r] = 0;
    for (const u of users) counts[u.role] = (counts[u.role] ?? 0) + 1;
    return counts;
  }, [users]);

  const disabledCount = useMemo(
    () => users.filter((u) => u.status !== "ACTIVE").length,
    [users],
  );
  const activeCount = users.length - disabledCount;

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter === "ACTIVE" && u.status !== "ACTIVE") return false;
      if (statusFilter === "DISABLED" && u.status === "ACTIVE") return false;
      if (roleFilter !== "ALL" && u.role !== roleFilter) return false;
      if (q) {
        const hay = `${u.name} ${u.email} ${ROLE_LABELS[u.role] ?? u.role}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, roleFilter, statusFilter, search]);

  const selectedUser = useMemo(
    () =>
      selectedUserId !== null
        ? users.find((u) => u.id === selectedUserId) ?? null
        : null,
    [users, selectedUserId],
  );

  const hasFilters = roleFilter !== "ALL" || statusFilter !== "ALL" || Boolean(search);

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-emerald-600/30 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-700" />
            <span>{feedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded p-1 text-emerald-800/70 hover:text-emerald-950"
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Top Section Switcher & Role/Search Filter Bar */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Users and access sections" className="flex flex-wrap items-center gap-1.5">
          <Link
            href="/users"
            aria-current="page"
            className="inline-flex items-center gap-2 rounded-xl border border-iica-700 bg-iica-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition"
          >
            <UsersIcon size={14} />
            <span>User accounts</span>
            <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
              {users.length}
            </span>
          </Link>

          <Link
            href="/access"
            className="inline-flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3.5 py-2 text-xs font-semibold text-ink/75 transition hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
          >
            <ShieldCheck size={14} />
            <span>Access levels</span>
          </Link>
        </nav>

        <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              value={roleFilter}
              onChange={(v) => setRoleFilter(v as typeof roleFilter)}
              className="min-w-[9rem]"
              ariaLabel="Filter accounts by role"
              options={[
                { value: "ALL", label: "All roles", count: users.length },
                ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r], count: roleUserCounts[r] ?? 0 })),
              ]}
            />

            <FilterSelect
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as "ALL" | "ACTIVE" | "DISABLED")}
              className="min-w-[9rem]"
              ariaLabel="Filter by account status"
              options={[
                { value: "ALL", label: "All statuses", count: users.length },
                { value: "ACTIVE", label: "Active", count: activeCount },
                { value: "DISABLED", label: "Disabled", count: disabledCount },
              ]}
            />

            <div className="relative min-w-[210px] flex-1 sm:w-64 sm:flex-none">
              <Search
                size={14}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink/45"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email..."
                className="field py-1.5 pr-7 pl-8 text-xs"
                aria-label="Search user accounts"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-ink/50 hover:text-ink"
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setRoleFilter("ALL");
                  setStatusFilter("ALL");
                  setSearch("");
                }}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-iica-700 hover:bg-iica-50"
              >
                Clear
              </button>
            )}
          </div>
      </div>

      {/* Main Content Workspace */}
      <div className="animate-fade panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/8 px-4 py-3.5 sm:px-5">
            <h2 className="text-sm font-semibold text-ink">User accounts</h2>

            <div role="group" aria-label="Accounts display mode" className="flex items-center gap-1">
              {(
                [
                  { id: "table", label: "Table", icon: <Table2 size={13} /> },
                  { id: "cards", label: "Cards", icon: <LayoutGrid size={13} /> },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={viewMode === mode.id}
                  onClick={() => setViewMode(mode.id)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${
                    viewMode === mode.id
                      ? "border-iica-700 bg-iica-700 text-white shadow-xs"
                      : "border-ink/12 bg-white text-ink/70 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
                  }`}
                >
                  {mode.icon}
                  <span>{mode.label}</span>
                </button>
              ))}
            </div>
          </div>

          {filteredUsers.length === 0 ? (
            <div className="py-12 text-center text-sm text-ink/60">
              No accounts match those filters.
            </div>
          ) : viewMode === "table" ? (
            <div className="overflow-x-auto">
              <table className="table-shell w-full min-w-[700px] [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3.5">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Access level</th>
                    <th>Status</th>
                    <th>Last sign-in</th>
                    <th>Added</th>
                    <th className="text-right">Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <button
                          type="button"
                          onClick={() => setSelectedUserId(user.id)}
                          className="flex w-full items-center gap-3 rounded-lg text-left transition hover:text-iica-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iica-600/40"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-iica-700 text-xs font-bold text-white">
                            {initials(user.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-ink">
                              {user.name}
                              {user.id === currentUserId && (
                                <span className="ml-2 rounded-full bg-iica-50 px-2 py-0.5 text-[10px] font-semibold text-iica-700">
                                  you
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-xs text-ink/55">{user.email}</span>
                          </span>
                        </button>
                      </td>
                      <td>
                        <RoleBadge role={user.role} />
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`chip gap-1.5 ${
                              user.status === "ACTIVE"
                                ? "border-emerald-600/35 bg-emerald-50 text-emerald-800"
                                : "border-rose-600/35 bg-rose-50 text-rose-700"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                user.status === "ACTIVE" ? "bg-emerald-600" : "bg-rose-600"
                              }`}
                            />
                            {user.status === "ACTIVE" ? "Active" : "Disabled"}
                          </span>
                          {user.must_change_password && (
                            <span className="chip border-gold-600/35 bg-gold-400/15 text-gold-700">
                              <KeyRound size={10} /> Temp password
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-xs text-ink/60 whitespace-nowrap">
                        {relativeTime(user.last_login_at)}
                      </td>
                      <td className="text-xs text-ink/55 whitespace-nowrap">
                        {formatDate(user.created_at)}
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingUser(user)}
                            className="btn btn-ghost px-2.5 py-1 text-xs"
                          >
                            <Pencil size={12} /> Edit
                          </button>
                          {user.id !== currentUserId && (
                            <button
                              type="button"
                              onClick={() => setRemovingUser(user)}
                              className="btn btn-danger px-2.5 py-1 text-xs"
                              aria-label={`Remove ${user.name}`}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4 sm:p-5">
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {filteredUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex flex-col justify-between rounded-2xl border border-ink/10 bg-white p-4 text-left transition hover:border-iica-300 hover:bg-iica-50/15"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedUserId(user.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition hover:text-iica-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iica-600/40"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-iica-700 text-xs font-bold text-white">
                            {initials(user.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-ink">
                              {user.name}
                            </span>
                            <span className="block truncate text-xs text-ink/55">{user.email}</span>
                          </span>
                        </button>
                        <span
                          className={`chip shrink-0 gap-1.5 ${
                            user.status === "ACTIVE"
                              ? "border-emerald-600/35 bg-emerald-50 text-emerald-800"
                              : "border-rose-600/35 bg-rose-50 text-rose-700"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              user.status === "ACTIVE" ? "bg-emerald-600" : "bg-rose-600"
                            }`}
                          />
                          {user.status === "ACTIVE" ? "Active" : "Disabled"}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <RoleBadge role={user.role} />
                        {user.id === currentUserId && (
                          <span className="rounded-full bg-iica-50 px-2 py-0.5 text-[10px] font-semibold text-iica-700">
                            Your account
                          </span>
                        )}
                        {user.must_change_password && (
                          <span className="chip border-gold-600/35 bg-gold-400/15 text-gold-700">
                            <KeyRound size={10} /> Temp password
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-ink/8 pt-2.5 text-[11px] text-ink/60">
                      <span>Last sign-in: {relativeTime(user.last_login_at)}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingUser(user)}
                          className="rounded-lg px-2 py-1 text-xs font-medium text-iica-700 hover:bg-iica-50"
                        >
                          Edit
                        </button>
                        {user.id !== currentUserId && (
                          <button
                            type="button"
                            onClick={() => setRemovingUser(user)}
                            className="rounded-lg px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                            aria-label={`Remove ${user.name}`}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer Role Distribution + Filtered Total */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 px-4 py-3 text-xs text-ink/60 sm:px-5">
            <div className="flex flex-wrap items-center gap-1.5">
              {ROLES.map((r) => (
                <span
                  key={r}
                  className="inline-flex cursor-default items-center rounded-lg border border-ink/12 bg-iica-50/50 px-2.5 py-0.5 text-[11px] font-medium text-ink/70 select-none"
                >
                  {ROLE_LABELS[r]}: {roleUserCounts[r] ?? 0}
                </span>
              ))}
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/65">
              {filteredUsers.length === users.length ? (
                <>
                  <span>Total accounts:</span>
                  <span className="font-semibold text-ink tabular-nums">{users.length}</span>
                </>
              ) : (
                <>
                  <span>Showing</span>
                  <span className="font-semibold text-ink tabular-nums">{filteredUsers.length}</span>
                  <span>of</span>
                  <span className="font-semibold text-ink tabular-nums">{users.length}</span>
                  <span>accounts</span>
                </>
              )}
            </div>
          </div>
        </div>

      {/* User Details Modal (Click-to-open) */}
      <Modal
        open={Boolean(selectedUser)}
        onClose={() => setSelectedUserId(null)}
        title={selectedUser?.name ?? "User details"}
        description={selectedUser?.email}
        width="max-w-lg"
      >
        {selectedUser && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-iica-700 text-sm font-bold text-white">
                  {initials(selectedUser.name)}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RoleBadge role={selectedUser.role} />
                    <span
                      className={`chip gap-1.5 ${
                        selectedUser.status === "ACTIVE"
                          ? "border-emerald-600/35 bg-emerald-50 text-emerald-800"
                          : "border-rose-600/35 bg-rose-50 text-rose-700"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          selectedUser.status === "ACTIVE" ? "bg-emerald-600" : "bg-rose-600"
                        }`}
                      />
                      {selectedUser.status === "ACTIVE" ? "Active" : "Disabled"}
                    </span>
                    {selectedUser.must_change_password && (
                      <span className="chip border-gold-600/35 bg-gold-400/15 text-gold-700">
                        <KeyRound size={10} /> Temp password pending
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink/60">
                    {ROLE_DESCRIPTIONS[selectedUser.role]}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 rounded-xl border border-ink/8 bg-iica-50/45 p-3.5 text-xs sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <Mail size={14} className="shrink-0 text-iica-700" />
                <span className="truncate font-medium text-ink">{selectedUser.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <UserCheck size={14} className="shrink-0 text-iica-700" />
                <span className="text-ink/75">Added {formatDate(selectedUser.created_at)}</span>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Clock size={14} className="shrink-0 text-iica-700" />
                <span className="text-ink/75">
                  Last sign-in:{" "}
                  <strong className="font-semibold text-ink">
                    {selectedUser.last_login_at
                      ? `${relativeTime(selectedUser.last_login_at)} (${toAstDateTime(selectedUser.last_login_at)})`
                      : "Never signed in"}
                  </strong>
                </span>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-ink">
                <span>Granted permissions ({matrix[selectedUser.role]?.length ?? 0})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(matrix[selectedUser.role] ?? []).map((perm) => (
                  <span
                    key={perm}
                    className="inline-flex items-center gap-1 rounded-lg border border-ink/10 bg-white px-2.5 py-1 text-[11px] font-medium text-ink/80"
                  >
                    <Check size={11} className="text-emerald-700" />
                    {PERMISSION_COPY[perm].label}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-ink/8 pt-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = selectedUser;
                    setSelectedUserId(null);
                    setEditingUser(target);
                  }}
                  className="btn btn-ghost py-2 text-xs"
                >
                  <Pencil size={13} /> Edit account
                </button>
                {selectedUser.id !== currentUserId && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = selectedUser;
                      setSelectedUserId(null);
                      setRemovingUser(target);
                    }}
                    className="btn btn-danger py-2 text-xs"
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserId(null)}
                className="btn btn-ghost px-4 py-2 text-xs"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Account Modal */}
      <Modal
        open={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        title={`Edit ${editingUser?.name ?? ""}`}
        description={editingUser?.id === currentUserId ? "This is your own account." : undefined}
      >
        {editingUser && (
          <UpdateUserForm
            key={editingUser.id}
            user={editingUser}
            isSelf={editingUser.id === currentUserId}
            onDone={() => setEditingUser(null)}
            onSuccess={(msg) => setFeedback(msg)}
          />
        )}
      </Modal>

      {/* Remove Account Modal */}
      <Modal
        open={Boolean(removingUser)}
        onClose={() => setRemovingUser(null)}
        title={`Remove ${removingUser?.name ?? ""}?`}
        width="max-w-md"
      >
        {removingUser && (
          <RemoveUserForm
            key={removingUser.id}
            user={removingUser}
            onDone={() => setRemovingUser(null)}
            onSuccess={(msg) => setFeedback(msg)}
          />
        )}
      </Modal>
    </div>
  );
}
