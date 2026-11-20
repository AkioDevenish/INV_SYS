import Link from "next/link";
import { Suspense } from "react";
import { ListTree } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getReferenceLists, listAllLessons, listProjectIdsForUser, listProjects } from "@/lib/projects";
import { astTodayKey } from "@/lib/project-meta";
import { PageHeader } from "@/components/ui";
import { ExportDialog } from "@/components/export-dialog";
import { NewProjectButton, type ProjectRefs } from "./project-form";
import { ProjectsView } from "./projects-view";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const user = await requirePermission("projects.view");
  const [canManage, refs, projects, lessons, mine] = await Promise.all([
    can(user.role, "projects.manage"),
    getReferenceLists(),
    listProjects(),
    listAllLessons(),
    listProjectIdsForUser(user.userId),
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
      <PageHeader
        eyebrow="Project life cycle"
        title="TT Delegation Projects"
        description="Every project's status, model phase, people, funding, progress, documents and lessons in one record."
        actions={
          <>
            <ExportDialog
              datasets={[
                {
                  key: "projects",
                  label: "Projects",
                  hint: "Projects, statuses, phases, programme areas, tags and funding totals",
                  allowed: true,
                },
              ]}
              groups={[]}
              defaultDataset="projects"
              title="Export projects"
              description="Download the project portfolio as Excel, CSV or JSON."
            />
            {canManage && (
              <>
                <Link href="/projects/lists" className="btn btn-ghost">
                  <ListTree size={15} /> Reference lists
                </Link>
                <NewProjectButton refs={formRefs} />
              </>
            )}
          </>
        }
      />

      <Suspense fallback={<div className="panel h-96 animate-pulse" />}>
        <ProjectsView
          projects={projects}
          lessons={lessons}
          statuses={refs.status}
          phases={refs.phase}
          areas={refs.programmeArea}
          tags={refs.tag}
          fundingStatuses={refs.fundingStatus}
          myProjectIds={mine}
          todayKey={astTodayKey()}
        />
      </Suspense>
    </>
  );
}
