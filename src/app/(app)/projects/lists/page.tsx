import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { getReferenceLists } from "@/lib/projects";
import { REFERENCE_KINDS, REFERENCE_META, type ReferenceKind } from "@/lib/project-meta";
import { PageHeader } from "@/components/ui";
import { ReferenceEditor } from "./reference-editor";

export const metadata = { title: "Project reference lists" };

export default async function ProjectListsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  await requirePermission("projects.manage");
  const [lists, { list }] = await Promise.all([getReferenceLists(), searchParams]);
  const active: ReferenceKind = (REFERENCE_KINDS as readonly string[]).includes(list ?? "")
    ? (list as ReferenceKind)
    : "status";

  return (
    <>
      <Link
        href="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink/60 transition hover:text-ink"
      >
        <ArrowLeft size={15} /> Back to projects
      </Link>
      <PageHeader
        eyebrow="Project life cycle"
        title="Reference lists"
        description="The approved values projects are classified with. They start with working values; rename or extend them as IICA confirms the final lists."
      />

      <nav aria-label="Reference lists" className="mb-4 flex flex-wrap gap-1.5">
        {REFERENCE_KINDS.map((k) => {
          const on = k === active;
          return (
            <Link
              key={k}
              href={k === "status" ? "/projects/lists" : `/projects/lists?list=${k}`}
              aria-current={on ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
                on
                  ? "border-iica-700 bg-iica-700 text-white shadow-xs"
                  : "border-ink/12 bg-white text-ink/75 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
              }`}
            >
              {REFERENCE_META[k].label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${on ? "bg-white/20" : "bg-ink/6 text-ink/65"}`}>
                {lists[k].length}
              </span>
            </Link>
          );
        })}
      </nav>

      <ReferenceEditor key={active} kind={active} rows={lists[active]} />
    </>
  );
}
