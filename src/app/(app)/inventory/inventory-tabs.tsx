import Link from "next/link";
import { Archive, ArrowLeftRight, Boxes, Filter, FolderArchive, Layers } from "lucide-react";
import { formatNumber } from "@/lib/format";

/**
 * Groups are separated gently on wider screens without adding left margin that
 * misaligns a wrapped row on phones.
 */
const GROUP_CLASS = "flex flex-none flex-wrap gap-1.5 sm:border-l sm:border-ink/10 sm:pl-3";

type InventoryTabKey = "all" | "items" | "it-items" | "filling-cabinet" | "cabi" | "movements";

/**
 * Inventory views keep separate routes because each carries its own filters and
 * deep links, but they present as a single section.
 */
export function InventoryTabs({
  active,
  allItemsCount,
  itemCount,
  movementCount,
  fillingCabinetCount,
  cabiCount,
  itItemsCount,
  itCategoryId,
}: {
  active: InventoryTabKey;
  allItemsCount?: number;
  itemCount?: number;
  movementCount?: number;
  fillingCabinetCount?: number;
  cabiCount?: number;
  itItemsCount?: number;
  itCategoryId?: number;
}) {
  const tab = (
    href: string,
    key: InventoryTabKey,
    label: string,
    count: number | undefined,
    Icon: typeof Boxes,
    title?: string,
  ) => {
    const on = active === key;
    return (
      <Link
        href={href}
        aria-current={on ? "page" : undefined}
        title={title}
        className={`flex flex-none items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
          on
            ? "border-iica-700 bg-iica-700 text-white shadow-xs"
            : "border-ink/12 bg-white text-ink/75 hover:border-iica-300 hover:bg-iica-50 hover:text-iica-800"
        }`}
      >
        <Icon size={15} aria-hidden="true" />
        {label}
        {count !== undefined && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
              on ? "bg-white/20 text-white" : "bg-ink/8 text-ink/65"
            }`}
          >
            {formatNumber(count)}
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Inventory sections"
      className="mb-5 flex w-full flex-wrap items-center gap-2"
    >
      <div className="flex flex-none flex-wrap gap-1.5">
        {tab(
          "/inventory?locationGroup=all",
          "all",
          "All items",
          allItemsCount,
          Layers,
          "Every item across IICA, Filling Cabinet and CABI",
        )}
        {tab(
          "/inventory",
          "items",
          "IICA Items",
          itemCount,
          Boxes,
          "Everything outside the filling cabinet and CABI",
        )}
        {tab(
          "/inventory?locationGroup=filling-cabinet",
          "filling-cabinet",
          "Filling Cabinet",
          fillingCabinetCount,
          Archive,
          "Items held on the six cabinet shelves",
        )}
        {tab(
          "/inventory?locationGroup=cabi",
          "cabi",
          "CABI Items",
          cabiCount,
          FolderArchive,
          "Items held at CABI",
        )}
      </div>

      {itCategoryId !== undefined && (
        <div className={GROUP_CLASS}>
          {tab(
            `/inventory?category=${itCategoryId}`,
            "it-items",
            "IT equipment",
            itItemsCount,
            Filter,
            "Category shortcut across all IT equipment",
          )}
        </div>
      )}

      <div className={GROUP_CLASS}>
        {tab(
          "/movements",
          "movements",
          "Stock movements",
          movementCount,
          ArrowLeftRight,
          "Every receipt, issue and adjustment",
        )}
      </div>
    </nav>
  );
}
