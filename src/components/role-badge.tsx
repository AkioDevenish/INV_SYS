import { ROLE_LABELS, type Role } from "@/lib/roles";

const STYLES: Record<Role, string> = {
  ADMIN: "border-iica-200 bg-iica-50 text-iica-800",
  MANAGER: "border-iica-600/45 bg-iica-200 text-iica-800",
  STAFF: "border-sky-600/40 bg-sky-100 text-sky-800",
  VIEWER: "border-ink/30 bg-ink/10 text-ink/70",
};

export function RoleBadge({ role, className = "" }: { role: Role; className?: string }) {
  return (
    <span className={`chip ${STYLES[role] ?? STYLES.VIEWER} ${className}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}
