import { CONDITION_META, type Condition } from "@/lib/conditions";

/**
 * Shown only when there is something to say. Most items are in service, and a
 * green "In service" chip on every row would be noise that hides the handful
 * that actually need attention - so in lists the default condition renders
 * nothing at all.
 */
export function ConditionBadge({
  condition,
  always = false,
  className = "",
}: {
  condition: Condition;
  /** The item record shows the condition even when it is the default. */
  always?: boolean;
  className?: string;
}) {
  const meta = CONDITION_META[condition];
  if (!meta || (!always && condition === "IN_SERVICE")) return null;

  return (
    <span className={`chip ${meta.chip} ${className}`} title={meta.description}>
      {meta.label}
    </span>
  );
}
