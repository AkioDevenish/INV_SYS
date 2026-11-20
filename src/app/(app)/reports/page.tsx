import { redirect } from "next/navigation";

/** Reporting was folded into the dashboard; this keeps old links working. */
export default function ReportsPage() {
  redirect("/dashboard");
}
