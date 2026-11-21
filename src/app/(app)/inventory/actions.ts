"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { assertPermission, recordAudit } from "@/lib/auth";
import {
  CONDITION_META,
  isRetiredCondition,
  parseConditionInput,
  type Condition,
} from "@/lib/conditions";
import {
  MAX_INVENTORY_IMPORT_BYTES,
  importInventoryWorkbook,
  type ImportReport,
} from "@/lib/inventory-import";
import { isPlaceholderSku, normalizeSku } from "@/lib/sku";

export type FormState = { error?: string; ok?: boolean };

const MAX_PG_INT = 2_147_483_647;
const MAX_UNIT_COST = 999_999_999_999.99;

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function parsePgInt(
  raw: string,
  label: string,
  options: { required?: boolean; min?: number; defaultValue?: number } = {},
): { value?: number; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    if (options.required) return { error: `${label} is required.` };
    return { value: options.defaultValue ?? 0 };
  }
  const value = Number(trimmed);
  const min = options.min ?? 0;
  if (!Number.isInteger(value)) {
    return { error: `${label} must be a whole number.` };
  }
  if (value < min) {
    return {
      error: min === 0 ? `${label} cannot be negative.` : `${label} must be at least ${min}.`,
    };
  }
  if (value > MAX_PG_INT) {
    return { error: `${label} exceeds the maximum allowed (${MAX_PG_INT.toLocaleString()}).` };
  }
  return { value };
}

function parseOptionalRefId(
  formData: FormData,
  key: string,
  label: string,
): { value?: number | null; error?: string } {
  const raw = text(formData, key);
  if (!raw) return { value: null };
  const parsed = parsePgInt(raw, label, { min: 1 });
  if (parsed.error) return { error: `Invalid ${label.toLowerCase()} selection.` };
  return { value: parsed.value ?? null };
}

function parseUnitCost(formData: FormData): { value?: number; error?: string } {
  const raw = text(formData, "unit_cost");
  if (!raw) return { value: 0 };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: "Unit cost must be a valid number." };
  if (value < 0) return { error: "Unit cost cannot be negative." };
  if (value > MAX_UNIT_COST) return { error: "Unit cost exceeds the maximum allowed amount." };
  return { value: Math.round(value * 100) / 100 };
}

function parseConditionField(formData: FormData): { value?: Condition; error?: string } {
  const raw = text(formData, "condition");
  if (!raw) return { value: "IN_SERVICE" };
  const parsed = parseConditionInput(raw);
  if (!parsed) return { error: "Choose a valid item condition." };
  return { value: parsed };
}

function parseItemPayload(formData: FormData) {
  const name = text(formData, "name");
  if (!name) return { error: "The item needs a name." } as const;

  const quantity = parsePgInt(text(formData, "quantity"), "Quantity", { defaultValue: 0 });
  if (quantity.error) return { error: quantity.error } as const;

  const minQuantity = parsePgInt(text(formData, "min_quantity"), "Minimum level", {
    defaultValue: 0,
  });
  if (minQuantity.error) return { error: minQuantity.error } as const;

  const unitCost = parseUnitCost(formData);
  if (unitCost.error) return { error: unitCost.error } as const;

  const categoryId = parseOptionalRefId(formData, "category_id", "Category");
  if (categoryId.error) return { error: categoryId.error } as const;

  const locationId = parseOptionalRefId(formData, "location_id", "Location");
  if (locationId.error) return { error: locationId.error } as const;

  const condition = parseConditionField(formData);
  if (condition.error) return { error: condition.error } as const;

  return {
    data: {
      sku: normalizeSku(text(formData, "sku")),
      name,
      description: text(formData, "description") || null,
      categoryId: categoryId.value ?? null,
      locationId: locationId.value ?? null,
      unit: text(formData, "unit") || "unit",
      quantity: quantity.value!,
      minQuantity: minQuantity.value!,
      unitCost: unitCost.value!,
      supplier: text(formData, "supplier") || null,
      condition: condition.value!,
      conditionNote: text(formData, "condition_note") || null,
    },
  } as const;
}

export async function createItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let newId: number;
  try {
    const user = await assertPermission("inventory.manage");
    const parsed = parseItemPayload(formData);
    if ("error" in parsed) return { error: parsed.error };
    const item = parsed.data;

    const txResult = await sql.begin(async (tx) => {
      if (item.categoryId) {
        const [cat] = await tx<{ id: number }[]>`
          SELECT id FROM categories WHERE id = ${item.categoryId}`;
        if (!cat) return { error: "Selected category no longer exists." } as const;
      }
      if (item.locationId) {
        const [loc] = await tx<{ id: number }[]>`
          SELECT id FROM locations WHERE id = ${item.locationId}`;
        if (!loc) return { error: "Selected location no longer exists." } as const;
      }
      if (item.sku) {
        const [dup] = await tx<{ id: number }[]>`
          SELECT id FROM items WHERE upper(sku) = ${item.sku} LIMIT 1`;
        if (dup) return { error: "That SKU is already in use." } as const;
      }

      const [inserted] = await tx<{ id: number }[]>`
        INSERT INTO items (sku, name, description, category_id, location_id, unit, quantity,
                           min_quantity, unit_cost, supplier, condition, condition_note)
        VALUES (${item.sku}, ${item.name}, ${item.description},
                ${item.categoryId}, ${item.locationId},
                ${item.unit}, ${item.quantity}, ${item.minQuantity},
                ${item.unitCost}, ${item.supplier},
                ${item.condition}, ${item.conditionNote})
        RETURNING id`;

      if (item.quantity > 0 && !isRetiredCondition(item.condition)) {
        await tx`
          INSERT INTO movements (item_id, user_id, user_label, type, quantity, balance_after, note)
          VALUES (${inserted.id}, ${user.userId}, ${user.name}, 'IN',
                  ${item.quantity}, ${item.quantity}, 'Opening balance')`;
      }

      await recordAudit(
        {
          user,
          action: "CREATE",
          entity: "item",
          entityId: inserted.id,
          details: `${item.sku ?? "no asset code"} - ${item.name}`,
        },
        tx,
      );
      return { id: inserted.id } as const;
    });

    if ("error" in txResult) return { error: txResult.error };
    newId = txResult.id;
  } catch (error) {
    return { error: describe(error, "That SKU is already in use.") };
  }

  revalidatePath("/inventory");
  revalidatePath("/movements");
  revalidatePath("/dashboard");
  redirect(`/inventory/${newId}`);
}

export async function updateItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let id: number;
  try {
    const user = await assertPermission("inventory.manage");
    const parsedId = parsePgInt(text(formData, "id"), "Item reference", {
      required: true,
      min: 1,
    });
    if (parsedId.error || !parsedId.value) return { error: "Missing item reference." };
    id = parsedId.value;

    const parsed = parseItemPayload(formData);
    if ("error" in parsed) return { error: parsed.error };
    const item = parsed.data;
    const preservedPlaceholder = normalizeSku(text(formData, "existing_placeholder_sku"));

    const txResult = await sql.begin(async (tx) => {
      const [existing] = await tx<{ sku: string | null; quantity: number; condition: string }[]>`
        SELECT sku, quantity, condition FROM items WHERE id = ${id} FOR UPDATE`;
      if (!existing) return { error: "That item no longer exists." } as const;

      // Preserve the internal placeholder handle when the SKU input was shown blank and untouched.
      const effectiveSku =
        item.sku ??
        (preservedPlaceholder &&
        isPlaceholderSku(preservedPlaceholder) &&
        existing.sku &&
        existing.sku.toUpperCase() === preservedPlaceholder
          ? existing.sku
          : null);

      if (
        item.quantity !== existing.quantity &&
        (isRetiredCondition(existing.condition) || isRetiredCondition(item.condition))
      ) {
        return {
          error:
            "Quantity cannot be changed on a decommissioned or disposed item. Update its condition first or record a stock movement before retiring it.",
        } as const;
      }

      if (item.categoryId) {
        const [cat] = await tx<{ id: number }[]>`
          SELECT id FROM categories WHERE id = ${item.categoryId}`;
        if (!cat) return { error: "Selected category no longer exists." } as const;
      }
      if (item.locationId) {
        const [loc] = await tx<{ id: number }[]>`
          SELECT id FROM locations WHERE id = ${item.locationId}`;
        if (!loc) return { error: "Selected location no longer exists." } as const;
      }
      if (effectiveSku) {
        const [dup] = await tx<{ id: number }[]>`
          SELECT id FROM items WHERE upper(sku) = ${effectiveSku.toUpperCase()} AND id <> ${id} LIMIT 1`;
        if (dup) return { error: "That SKU is already in use." } as const;
      }

      await tx`
        UPDATE items SET sku = ${effectiveSku}, name = ${item.name},
                         description = ${item.description},
                         category_id = ${item.categoryId},
                         location_id = ${item.locationId},
                         unit = ${item.unit},
                         quantity = ${item.quantity},
                         min_quantity = ${item.minQuantity},
                         unit_cost = ${item.unitCost},
                         supplier = ${item.supplier},
                         condition = ${item.condition},
                         condition_note = ${item.conditionNote},
                         updated_at = now()
        WHERE id = ${id}`;

      // Editing the quantity directly is a correction - keep the ledger honest.
      if (item.quantity !== existing.quantity) {
        await tx`
          INSERT INTO movements (item_id, user_id, user_label, type, quantity, balance_after, note)
          VALUES (${id}, ${user.userId}, ${user.name}, 'ADJUST',
                  ${item.quantity - existing.quantity}, ${item.quantity},
                  'Corrected while editing the item')`;
      }

      await recordAudit(
        {
          user,
          action: "UPDATE",
          entity: "item",
          entityId: id,
          details: effectiveSku ?? item.name,
        },
        tx,
      );

      if (item.condition !== existing.condition) {
        const from =
          CONDITION_META[existing.condition as keyof typeof CONDITION_META]?.label ??
          existing.condition;
        const to =
          CONDITION_META[item.condition as keyof typeof CONDITION_META]?.label ?? item.condition;
        await recordAudit(
          {
            user,
            action: "CONDITION_CHANGE",
            entity: "item",
            entityId: id,
            details: `${effectiveSku ?? item.name}: ${from} -> ${to}${
              item.conditionNote ? ` (${item.conditionNote})` : ""
            }`,
          },
          tx,
        );
      }

      return { ok: true } as const;
    });

    if ("error" in txResult) return { error: txResult.error };
  } catch (error) {
    return { error: describe(error, "That SKU is already in use.") };
  }

  revalidatePath("/inventory");
  revalidatePath(`/inventory/${id}`);
  revalidatePath("/movements");
  revalidatePath("/dashboard");
  return { ok: true };
}

function safeInventoryRedirect(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === "/inventory" || trimmed.startsWith("/inventory?")) return trimmed;
  return null;
}

export async function deleteItemAction(
  prevOrFormData: FormState | FormData,
  maybeFormData?: FormData,
): Promise<FormState> {
  const formData = prevOrFormData instanceof FormData ? prevOrFormData : maybeFormData;
  if (!formData) return { error: "Missing form submission." };

  let id: number;
  let redirectTarget: string | null = null;
  try {
    const user = await assertPermission("inventory.manage");
    const parsedId = parsePgInt(text(formData, "id"), "Item reference", {
      required: true,
      min: 1,
    });
    if (parsedId.error || !parsedId.value) return { error: "Missing item reference." };
    id = parsedId.value;
    redirectTarget = safeInventoryRedirect(text(formData, "redirect_to"));

    const txResult = await sql.begin(async (tx) => {
      const [item] = await tx<{ sku: string | null; name: string }[]>`
        DELETE FROM items WHERE id = ${id} RETURNING sku, name`;
      if (!item) return { error: "That item no longer exists." } as const;

      await recordAudit(
        {
          user,
          action: "DELETE",
          entity: "item",
          entityId: id,
          details: `${item.sku ?? "no asset code"} - ${item.name}`,
        },
        tx,
      );
      return { ok: true } as const;
    });

    if ("error" in txResult) return { error: txResult.error };
  } catch (error) {
    return { error: describe(error, "Could not delete that item.") };
  }

  revalidatePath("/inventory");
  revalidatePath(`/inventory/${id}`);
  revalidatePath("/movements");
  revalidatePath("/dashboard");

  if (redirectTarget) {
    redirect(redirectTarget);
  }
  return { ok: true };
}

function describe(error: unknown, uniqueMessage: string): string {
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "23505" || message.includes("duplicate key value")) {
    return uniqueMessage;
  }
  if (code === "23503") {
    return "The selected category or location no longer exists.";
  }
  if (code === "22003") {
    return "One of the numeric values is out of range.";
  }
  if (code === "22P02") {
    return "One of the submitted values has an invalid format.";
  }
  if (
    message === "You are not signed in." ||
    message === "You must choose a new password before continuing." ||
    message === "Your role does not allow this action."
  ) {
    return message;
  }
  console.error("[inventory/actions]", error);
  return "Something went wrong while saving the item. Please try again.";
}

export type ImportState = { error?: string; report?: ImportReport };

/**
 * Bulk enrichment from a spreadsheet. Existing items are never overwritten, so
 * this is safe to run repeatedly: a second pass over the same file reports
 * everything as already complete rather than churning the catalogue.
 */
export async function importInventoryAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  try {
    const user = await assertPermission("inventory.manage");
    const file = formData.get("inventory_file");
    if (!(file instanceof File) || !file.size) return { error: "Choose a spreadsheet to import." };
    if (file.size > MAX_INVENTORY_IMPORT_BYTES) {
      return { error: "The workbook is too large (10 MB maximum)." };
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return { error: "Only .xlsx workbooks are supported. Save the file as Excel Workbook first." };
    }
    const report = await importInventoryWorkbook(await file.arrayBuffer(), user);
    revalidatePath("/inventory");
    revalidatePath("/movements");
    revalidatePath("/dashboard");
    return { report };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("header row") ||
      message.includes("no sheets") ||
      message.includes("too large") ||
      message.includes("Choose a spreadsheet") ||
      message.startsWith("You ") ||
      message.startsWith("Your role")
    ) {
      return { error: message };
    }
    console.error("[importInventoryAction]", error);
    return { error: "Could not read that workbook. Check that it is a valid .xlsx file." };
  }
}
