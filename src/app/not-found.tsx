import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { getCurrentUser } from "@/lib/auth";
import { defaultHomeForRole, getPermissionMatrix } from "@/lib/permissions";

export const metadata = { title: "Page not found" };

export default async function NotFound() {
  let href = "/";
  let label = "Go home";

  try {
    const user = await getCurrentUser();
    if (!user) {
      href = "/login";
      label = "Back to sign in";
    } else if (user.mustChangePassword) {
      href = "/change-password";
      label = "Choose your password";
    } else {
      const matrix = await getPermissionMatrix();
      href = defaultHomeForRole(matrix, user.role);
      label = href === "/dashboard" ? "Back to the dashboard" : "Back to workspace";
    }
  } catch (error) {
    unstable_rethrow(error);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <BrandMark size={44} />
      <h1 className="mt-6 text-xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-ink/65">
        The page you were looking for has been moved or never existed.
      </p>
      <Link href={href} className="btn btn-primary mt-7">
        {label}
      </Link>
    </div>
  );
}
