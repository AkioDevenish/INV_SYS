import { redirect } from "next/navigation";

/** Folded into the combined categories & locations page. */
export default function LocationsPage() {
  redirect("/taxonomy?view=locations");
}
