"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { assertPermission, recordAudit } from "@/lib/auth";
import { CONDITION_META, isRetiredCondition, type Condition } from "@/lib/conditions";
import { formatUnits } from "@/lib/format";

export type MovementState = { error?: string; ok?: boolean; message?: string };

const MAX_PG_INT = 2_147_483_647;
const MOVEMENT_TYPES = ["IN", "OUT", "ADJUST"] as const;

export async function recordMovementAction(
  _prev: MovementState,
  formData: FormData,
): Promise<MovementState> {
  try {
    const user = await assertPermission("movement.record");

    const rawItemId = String(formData.get("item_id") ?? "").trim();
    const itemId = Number(rawItemId);
    const type = String(formData.get("type") ?? "");
    const rawAmount = String(formData.get("quantity") ?? "").trim();
    const amount = rawAmount === "" ? NaN : Number(rawAmount);
    const note = String(formData.get("note") ?? "").trim();

    if (!rawItemId || !Number.isInteger(itemId) || itemId < 1 || itemId > MAX_PG_INT) {
      return { error: "Choose an item first." };
    }
    if (!MOVEMENT_TYPES.includes(type as (typeof MOVEMENT_TYPES)[number])) {
      return { error: "Choose a movement type." };
    }
    if (!Number.isInteger(amount)) {
      return { error: "Enter a whole number quantity." };
    }
    if (type === "ADJUST" ? amount < 0 : amount <= 0) {
      return {
        error:
          type === "ADJUST"
            ? "Counted quantity cannot be negative."
            : "Enter a quantity greater than zero.",
      };
    }
    if (amount > MAX_PG_INT) {
      return { error: `Quantity exceeds maximum allowed (${MAX_PG_INT.toLocaleString()}).` };
    }

    const result = await sql.begin(async (tx) => {
      // Lock the row so two people moving the same item cannot race each other.
      const [item] = await tx<
        {
          id: number;
          name: string;
          sku: string | null;
          quantity: number;
          unit: string;
          condition: Condition;
        }[]
      >`SELECT id, name, sku, quantity, unit, condition FROM items WHERE id = ${itemId} FOR UPDATE`;

      if (!item) return { error: "That item no longer exists." } as const;

      if (isRetiredCondition(item.condition)) {
        const label = CONDITION_META[item.condition]?.label ?? item.condition;
        return {
          error: `${item.name} is marked ${label.toLowerCase()} and cannot record stock movements.`,
        } as const;
      }

      // ADJUST sets the balance outright; IN/OUT move it relative to what is there.
      const balanceAfter =
        type === "IN" ? item.quantity + amount : type === "OUT" ? item.quantity - amount : amount;

      if (balanceAfter > MAX_PG_INT) {
        return {
          error: `Resulting balance would exceed the maximum stock limit (${MAX_PG_INT.toLocaleString()}).`,
        } as const;
      }

      if (balanceAfter < 0) {
        return {
          error: `Only ${formatUnits(item.quantity, item.unit)} of ${item.name} are on hand - you cannot issue ${amount}.`,
        } as const;
      }

      const delta = balanceAfter - item.quantity;
      if (type === "ADJUST" && delta === 0) {
        return {
          error: `${item.name} is already at ${formatUnits(item.quantity, item.unit)} - no adjustment needed.`,
        } as const;
      }

      await tx`
        INSERT INTO movements (item_id, user_id, user_label, type, quantity, balance_after, note)
        VALUES (${itemId}, ${user.userId}, ${user.name}, ${type},
                ${type === "ADJUST" ? delta : amount}, ${balanceAfter}, ${note || null})`;

      await tx`UPDATE items SET quantity = ${balanceAfter}, updated_at = now() WHERE id = ${itemId}`;

      await recordAudit(
        {
          user,
          action: `MOVEMENT_${type}`,
          entity: "item",
          entityId: itemId,
          details: `${item.sku ?? "no SKU"} - ${item.quantity} → ${balanceAfter} ${item.unit}${
            note ? ` (${note})` : ""
          }`,
        },
        tx,
      );

      return { item, balanceAfter } as const;
    });

    if ("error" in result) return { error: result.error };

    const { item, balanceAfter } = result;

    revalidatePath("/movements");
    revalidatePath("/inventory");
    revalidatePath(`/inventory/${itemId}`);
    revalidatePath("/dashboard");

    return {
      ok: true,
      message: `${item.name} is now at ${formatUnits(balanceAfter, item.unit)}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message === "You are not signed in." ||
      message === "You must choose a new password before continuing." ||
      message === "Your role does not allow this action."
    ) {
      return { error: message };
    }
    console.error("[recordMovementAction]", error);
    return { error: "Could not record that movement. Please try again." };
  }
}
