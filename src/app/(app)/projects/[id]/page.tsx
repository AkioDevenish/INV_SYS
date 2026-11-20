import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser, requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listUsers } from "@/lib/queries";
import {
  getProject,
  getReferenceLists,
  isAssignedToProject,
  listResourceOptions,
  listStakeholderOptions,
} from "@/lib/projects";
import { astTodayKey, statusTone } from "@/lib/project-meta";
import { PageHeader } from "@/components/ui";
import { DeleteProjectButton, EditProjectButton, type ProjectRefs } from "../project-form";
import { ProjectWorkspace } from "./project-workspace";

const loadProject = cache(getProject);

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword || !(await can(user.role, "projects.view"))) {
    return { title: "Project" };
  }
  const id = parseId((await params).id);
  const project = id ? await loadProject(id) : null;
  return { title: project?.title ?? "Project" };
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePermission("projects.view");
  const id = parseId((await params).id);
  if (!id) notFound();

  const [project, refs, canManage, assigned, { tab }] = await Promise.all([
    loadProject(id),
    getReferenceLists(),
    can(user.role, "projects.manage"),
    isAssignedToProject(id, user.userId),
    searchParams,
  ]);
  if (!project) notFound();

  const [users, directory, resources] = await Promise.all([
    canManage ? listUsers() : Promise.resolve([]),
    canManage ? listStakeholderOptions() : Promise.resolve([]),
    canManage ? listResourceOptions(id) : Promise.resolve([]),
  ]);

  const formRefs: ProjectRefs = {
    statuses: refs.status,
    phases: refs.phase,
    fundingStatuses: refs.fundingStatus,
    areas: refs.programmeArea,
    tags: refs.tag,
  };

  return (
    <>
      <Link
        href="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink/60 transition hover:text-ink"
      >
        <ArrowLeft size={15} /> Back to projects
      </Link>

      <PageHeader
        eyebrow={project.code ? `Project ${project.code}` : "Project"}
        title={project.title}
        description={project.purpose ?? undefined}
        actions={
          canManage ? (
            <>
              <EditProjectButton project={project} refs={formRefs} />
              <DeleteProjectButton id={project.id} title={project.title} />
            </>
          ) : null
        }
      />

      <ProjectWorkspace
        project={project}
        statusClass={statusTone(project.status_position, project.is_closed, project.status_name)}
        phases={refs.phase}
        roles={refs.role}
        fundingStatuses={refs.fundingStatus}
        people={users.filter((u) => u.status === "ACTIVE").map((u) => ({ id: u.id, name: u.name }))}
        directory={directory}
        resources={resources}
        canManage={canManage}
        canContribute={canManage || assigned}
        userId={user.userId}
        todayKey={astTodayKey()}
        initialTab={tab}
      />
    </>
  );
}
