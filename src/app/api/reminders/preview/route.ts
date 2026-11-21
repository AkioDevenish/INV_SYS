import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { getDigestFor, renderDigestEmail } from "@/lib/reminders";

/** Shows the signed-in person their own reminder email exactly as it would be sent. */
export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const digest = await getDigestFor(auth.user.userId);
  if (!digest) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { subject, html } = renderDigestEmail(digest);
  return new NextResponse(html.replace("<body", `<body data-subject="${subject.replace(/"/g, "&quot;")}"`), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      // The email carries no scripts; lock the preview down accordingly.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'",
    },
  });
}
