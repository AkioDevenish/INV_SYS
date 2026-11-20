import Link from "next/link";
import { redirect } from "next/navigation";
import { Contact, MapPin, Tags } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  listCategories,
  listLocations,
  listStakeholderGroups,
} from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { TaxonomyManager } from "@/components/taxonomy-manager";

export const metadata = { title: "Reference lists" };

/**
 * The three built-in lists. These are not just convention: `items.category_id`,
 * `items.location_id` and `stakeholders.group_id` are real columns pointing at
 * real tables, which is why they cannot be created or deleted from here.
 */
const BUILT_IN = {
  categories: {
    label: "Inventory categories",
    icon: Tags,
    description: "Group the catalogue so reporting and searching stay meaningful as it grows.",
  },
  locations: {
    label: "Storage locations",
    icon: MapPin,
    description: "Stores, offices and sites where the organisation's stock physically sits.",
  },
  groups: {
    label: "Stakeholder groups",
    icon: Contact,
    description: "The main division of the stakeholder directory - ministries, partners, farmers.",
  },
} as const;

type BuiltIn = keyof typeof BUILT_IN;

export default async function TaxonomyPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireUser("/taxonomy");
  const [canManageCatalogue, canManageGroups, params] = await Promise.all([
    can(user.role, "taxonomy.manage"),
    can(user.role, "stakeholders.manage"),
    searchParams,
  ]);
  if (!canManageCatalogue && !canManageGroups) redirect("/denied?permission=taxonomy.manage");

  const [categories, locations, groups] = await Promise.all([
    canManageCatalogue ? listCategories() : Promise.resolve([]),
    canManageCatalogue ? listLocations() : Promise.resolve([]),
    canManageGroups ? listStakeholderGroups() : Promise.resolve([]),
  ]);

  const builtInVisible = (Object.keys(BUILT_IN) as BuiltIn[]).filter((key) =>
    key === "groups" ? canManageGroups : canManageCatalogue,
  );

  const asked: BuiltIn =
    params.view === "locations" ? "locations" : params.view === "groups" ? "groups" : "categories";
  const view: BuiltIn = builtInVisible.includes(asked) ? asked : builtInVisible[0];

  const counts: Record<BuiltIn, number> = {
    categories: categories.length,
    locations: locations.length,
    groups: groups.length,
  };

  const tabClass = (active: boolean) =>
    `flex shrink-0 items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
      active
        ? "border-iica-700 bg-iica-700 text-white shadow-xs"
        : "border-ink/12 bg-white text-ink/75 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
    }`;
  const badgeClass = (active: boolean) =>
    `rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
      active ? "bg-white/20 text-white" : "bg-ink/8 text-ink/65"
    }`;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Reference lists"
        description="Manage inventory categories, storage locations and stakeholder directory groups."
      />

      <nav
        aria-label="Reference lists"
        className="mb-5 flex flex-wrap gap-1.5"
      >
        {builtInVisible.map((key) => {
          const { label, icon: Icon } = BUILT_IN[key];
          const active = key === view;
          return (
            <Link
              key={key}
              href={key === "categories" ? "/taxonomy" : `/taxonomy?view=${key}`}
              aria-current={active ? "page" : undefined}
              className={tabClass(active)}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="whitespace-nowrap">{label}</span>
              <span className={badgeClass(active)}>{counts[key]}</span>
            </Link>
          );
        })}
      </nav>

      <div key={view} className="animate-fade">
        {view === "categories" && (
          <TaxonomyManager
            kind="category"
            noun="Category"
            entries={categories}
            canManage={canManageCatalogue}
          />
        )}
        {view === "locations" && (
          <TaxonomyManager
            kind="location"
            noun="Location"
            entries={locations}
            canManage={canManageCatalogue}
          />
        )}
        {view === "groups" && (
          <TaxonomyManager
            kind="stakeholderGroup"
            noun="Stakeholder group"
            entries={groups}
            canManage={canManageGroups}
            countNoun="contact"
            scope="the directory"
          />
        )}
      </div>
    </>
  );
}
