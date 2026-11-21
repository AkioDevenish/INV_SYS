"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { assertPermission, recordAudit } from "@/lib/auth";
import { CABI_LOCATION_NAME, FILLING_CABINET_LOCATION_NAMES } from "@/lib/queries";
import type { Permission } from "@/lib/roles";

export type TaxonomyKind = "category" | "location" | "stakeholderGroup";
export type TaxonomyState = { error?: string; ok?: boolean };

const MAX_PG_INT = 2_147_483_647;

/**
 * Stakeholder groups are managed by whoever manages the directory, not by
 * whoever manages the warehouse catalogue, even though the three lists share
 * one screen.
 */
const PERMISSIONS: Record<TaxonomyKind, Permission> = {
  category: "taxonomy.manage",
  location: "taxonomy.manage",
  stakeholderGroup: "stakeholders.manage",
};

const AUDIT_ENTITY: Record<TaxonomyKind, string> = {
  category: "category",
  location: "location",
  stakeholderGroup: "stakeholder_group",
};

/** Pages to refresh once one of these lists changes. */
const AFFECTED: Record<TaxonomyKind, string[]> = {
  category: ["/taxonomy", "/inventory", "/movements", "/dashboard"],
  location: ["/taxonomy", "/inventory", "/movements", "/dashboard"],
  stakeholderGroup: ["/taxonomy", "/stakeholders", "/dashboard"],
};

const SYSTEM_LOCATIONS = new Set<string>([
  "filling room",
  CABI_LOCATION_NAME.toLowerCase(),
  ...FILLING_CABINET_LOCATION_NAMES.map((name) => name.toLowerCase()),
]);

function systemGuardReason(kind: TaxonomyKind, name: string): string | null {
  const lower = name.trim().toLowerCase();
  if (kind === "location" && SYSTEM_LOCATIONS.has(lower)) {
    return `"${name}" is a system-managed location used by Inventory tabs and stock status rules.`;
  }
  if (kind === "category" && lower === "it equipment") {
    return `"${name}" is a system-managed category linked to the IT equipment tab.`;
  }
  return null;
}

function parseKind(raw: FormDataEntryValue | null): TaxonomyKind | null {
  if (raw === "category" || raw === "location" || raw === "stakeholderGroup") return raw;
  return null;
}

function parseOptionalId(raw: FormDataEntryValue | null): { value: number | null; invalid?: boolean } {
  const str = String(raw ?? "").trim();
  if (!str) return { value: null };
  const n = Number(str);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PG_INT) return { value: null, invalid: true };
  return { value: n };
}

function describeTaxonomyError(error: unknown, fallback: string): string {
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "23505" || message.includes("duplicate key value")) {
    return "Something with that name already exists.";
  }
  if (code === "22003" || code === "22P02") {
    return "Invalid entry reference.";
  }
  if (
    message === "You are not signed in." ||
    message === "You must choose a new password before continuing." ||
    message === "Your role does not allow this action."
  ) {
    return message;
  }
  console.error("[taxonomy/actions]", error);
  return fallback;
}

export async function saveTaxonomyAction(
  _prev: TaxonomyState,
  formData: FormData,
): Promise<TaxonomyState> {
  try {
    const kind = parseKind(formData.get("kind"));
    if (!kind) return { error: "Invalid list type." };

    const user = await assertPermission(PERMISSIONS[kind]);

    const parsedId = parseOptionalId(formData.get("id"));
    if (parsedId.invalid) return { error: "Invalid entry reference." };
    const id = parsedId.value;

    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;

    if (!name) return { error: "Enter a name." };

    const txResult = await sql.begin(async (tx) => {
      if (id) {
        const [existing] =
          kind === "category"
            ? await tx<{ id: number; name: string }[]>`
                SELECT id, name FROM categories WHERE id = ${id} FOR UPDATE`
            : kind === "location"
              ? await tx<{ id: number; name: string }[]>`
                  SELECT id, name FROM locations WHERE id = ${id} FOR UPDATE`
              : await tx<{ id: number; name: string }[]>`
                  SELECT id, name FROM stakeholder_groups WHERE id = ${id} FOR UPDATE`;

        if (!existing) return { error: "That entry no longer exists." } as const;

        if (existing.name.toLowerCase() !== name.toLowerCase()) {
          const guard = systemGuardReason(kind, existing.name);
          if (guard) {
            return {
              error: `${guard} It cannot be renamed (you can still update its description).`,
            } as const;
          }
        }

        const [dup] =
          kind === "category"
            ? await tx<{ id: number }[]>`
                SELECT id FROM categories WHERE lower(name) = ${name.toLowerCase()} AND id <> ${id} LIMIT 1`
            : kind === "location"
              ? await tx<{ id: number }[]>`
                  SELECT id FROM locations WHERE lower(name) = ${name.toLowerCase()} AND id <> ${id} LIMIT 1`
              : await tx<{ id: number }[]>`
                  SELECT id FROM stakeholder_groups WHERE lower(name) = ${name.toLowerCase()} AND id <> ${id} LIMIT 1`;

        if (dup) return { error: "Something with that name already exists." } as const;

        const [updated] =
          kind === "category"
            ? await tx<{ id: number }[]>`
                UPDATE categories SET name = ${name}, description = ${description} WHERE id = ${id} RETURNING id`
            : kind === "location"
              ? await tx<{ id: number }[]>`
                  UPDATE locations SET name = ${name}, description = ${description} WHERE id = ${id} RETURNING id`
              : await tx<{ id: number }[]>`
                  UPDATE stakeholder_groups SET name = ${name}, description = ${description} WHERE id = ${id} RETURNING id`;

        if (!updated) return { error: "That entry no longer exists." } as const;

        await recordAudit(
          { user, action: "UPDATE", entity: AUDIT_ENTITY[kind], entityId: id, details: name },
          tx,
        );
        return { ok: true } as const;
      }

      const [dup] =
        kind === "category"
          ? await tx<{ id: number }[]>`
              SELECT id FROM categories WHERE lower(name) = ${name.toLowerCase()} LIMIT 1`
          : kind === "location"
            ? await tx<{ id: number }[]>`
                SELECT id FROM locations WHERE lower(name) = ${name.toLowerCase()} LIMIT 1`
            : await tx<{ id: number }[]>`
                SELECT id FROM stakeholder_groups WHERE lower(name) = ${name.toLowerCase()} LIMIT 1`;

      if (dup) return { error: "Something with that name already exists." } as const;

      const [row] =
        kind === "category"
          ? await tx<{ id: number }[]>`
              INSERT INTO categories (name, description) VALUES (${name}, ${description})
              RETURNING id`
          : kind === "location"
            ? await tx<{ id: number }[]>`
                INSERT INTO locations (name, description) VALUES (${name}, ${description})
                RETURNING id`
            : await tx<{ id: number }[]>`
                INSERT INTO stakeholder_groups (name, description) VALUES (${name}, ${description})
                RETURNING id`;

      await recordAudit(
        {
          user,
          action: "CREATE",
          entity: AUDIT_ENTITY[kind],
          entityId: row.id,
          details: name,
        },
        tx,
      );
      return { ok: true } as const;
    });

    if ("error" in txResult) return { error: txResult.error };

    for (const path of AFFECTED[kind]) revalidatePath(path);
    if (kind === "stakeholderGroup") {
      revalidatePath("/stakeholders", "layout");
    }
    return { ok: true };
  } catch (error) {
    return { error: describeTaxonomyError(error, "Could not save that entry.") };
  }
}

export async function deleteTaxonomyAction(
  _prev: TaxonomyState,
  formData: FormData,
): Promise<TaxonomyState> {
  try {
    const kind = parseKind(formData.get("kind"));
    if (!kind) return { error: "Invalid list type." };

    const user = await assertPermission(PERMISSIONS[kind]);
    const parsedId = parseOptionalId(formData.get("id"));
    if (parsedId.invalid || !parsedId.value) return { error: "Nothing selected." };
    const id = parsedId.value;

    const txResult = await sql.begin(async (tx) => {
      const [existing] =
        kind === "category"
          ? await tx<{ id: number; name: string }[]>`
              SELECT id, name FROM categories WHERE id = ${id} FOR UPDATE`
          : kind === "location"
            ? await tx<{ id: number; name: string }[]>`
                SELECT id, name FROM locations WHERE id = ${id} FOR UPDATE`
            : await tx<{ id: number; name: string }[]>`
                SELECT id, name FROM stakeholder_groups WHERE id = ${id} FOR UPDATE`;

      if (!existing) return { error: "That entry no longer exists." } as const;

      const guard = systemGuardReason(kind, existing.name);
      if (guard) {
        return { error: `${guard} It cannot be deleted.` } as const;
      }

      const [deleted] =
        kind === "category"
          ? await tx<{ name: string }[]>`DELETE FROM categories WHERE id = ${id} RETURNING name`
          : kind === "location"
            ? await tx<{ name: string }[]>`DELETE FROM locations WHERE id = ${id} RETURNING name`
            : await tx<{ name: string }[]>`DELETE FROM stakeholder_groups WHERE id = ${id} RETURNING name`;

      if (!deleted) return { error: "That entry no longer exists." } as const;

      await recordAudit(
        {
          user,
          action: "DELETE",
          entity: AUDIT_ENTITY[kind],
          entityId: id,
          details: deleted.name,
        },
        tx,
      );
      return { ok: true } as const;
    });

    if ("error" in txResult) return { error: txResult.error };

    for (const path of AFFECTED[kind]) revalidatePath(path);
    if (kind === "stakeholderGroup") {
      revalidatePath("/stakeholders", "layout");
    }
    return { ok: true };
  } catch (error) {
    return { error: describeTaxonomyError(error, "Could not delete that entry.") };
  }
}
