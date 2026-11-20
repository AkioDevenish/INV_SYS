import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser, requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  getStakeholder,
  listStakeholderGroups,
} from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { PageHeader, SectionCard } from "@/components/ui";
import {
  DeleteStakeholderButton,
  EditStakeholderButton,
  safeTelHref,
} from "../stakeholder-form";

function parsePositiveInt(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
}

function safeHttpUrl(raw: string | null): string | undefined {
  const val = raw?.trim();
  if (!val || val.startsWith("//")) return undefined;
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(val) ? val : `https://${val}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (!parsed.hostname || (!parsed.hostname.includes(".") && parsed.hostname !== "localhost")) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !(await can(user.role, "stakeholders.view"))) {
    return { title: "Stakeholder" };
  }
  const id = parsePositiveInt((await params).id);
  if (!id) return { title: "Stakeholder" };
  const person = await getStakeholder(id);
  return { title: person?.name ?? "Stakeholder" };
}

export default async function StakeholderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("stakeholders.view");
  const id = parsePositiveInt((await params).id);
  if (!id) notFound();

  const person = await getStakeholder(id);
  if (!person) notFound();

  const canManage = await can(user.role, "stakeholders.manage");
  const groups = canManage ? await listStakeholderGroups() : [];

  const rows: { label: string; value: string | null; href?: string; external?: boolean }[] = [
    { label: "Organisation", value: person.organisation },
    { label: "Role", value: person.job_title },
    { label: "Group", value: person.group_name },
    { label: "Email", value: person.email, href: person.email ? `mailto:${person.email}` : undefined },
    {
      label: "Alternate email",
      value: person.alt_email,
      href: person.alt_email ? `mailto:${person.alt_email}` : undefined,
    },
    { label: "Phone", value: person.phone, href: safeTelHref(person.phone) },
    {
      label: "Alternate phone",
      value: person.alt_phone,
      href: safeTelHref(person.alt_phone),
    },
    { label: "Location", value: person.location },
    {
      label: "Website",
      value: person.website,
      href: safeHttpUrl(person.website),
      external: true,
    },
    { label: "Social media", value: person.social },
    { label: "Gender", value: person.gender },
    { label: "Age group", value: person.age_group },
    { label: "Added", value: formatDate(person.created_at) },
    { label: "Updated", value: formatDate(person.updated_at) },
  ];

  return (
    <>
      <Link
        href="/stakeholders"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink/55 transition hover:text-ink"
      >
        <ArrowLeft size={15} /> Back to stakeholders
      </Link>

      <PageHeader
        eyebrow={person.group_name ?? "Ungrouped"}
        title={person.name}
        description={person.job_title ?? undefined}
        actions={
          canManage ? (
            <>
              <EditStakeholderButton
                stakeholder={person}
                groups={groups.map((g) => ({ id: g.id, name: g.name }))}
              />
              <DeleteStakeholderButton id={person.id} name={person.name} />
            </>
          ) : null
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_1fr]">
        <SectionCard title="Contact details" bodyClassName="divide-y divide-ink/5">
          {rows
            .filter((row) => row.value)
            .map((row) => (
              <div key={row.label} className="flex items-baseline gap-4 px-5 py-3">
                <span className="w-36 shrink-0 text-xs uppercase tracking-[0.1em] text-ink/50">
                  {row.label}
                </span>
                <span className="min-w-0 flex-1 break-words text-sm text-ink/85">
                  {row.href ? (
                    <a
                      className="text-iica-700 hover:underline"
                      href={row.href}
                      target={row.external ? "_blank" : undefined}
                      rel={row.external ? "noopener noreferrer" : undefined}
                    >
                      {row.value}
                    </a>
                  ) : (
                    row.value
                  )}
                </span>
              </div>
            ))}
        </SectionCard>

        {person.notes && (
          <SectionCard title="Notes" bodyClassName="px-5 py-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/70">
              {person.notes}
            </p>
          </SectionCard>
        )}
      </div>
    </>
  );
}
