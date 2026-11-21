import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { sql } from "@/lib/db";

/** Types a browser may open inline; everything else downloads. Never HTML or SVG. */
const INLINE = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
]);

/** Downloads a file uploaded to a project document. Needs "See projects". */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiPermission("projects.view");
  if (!auth.ok) return auth.response;
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const [file] = await sql<{ filename: string; mime_type: string; data: Buffer }[]>`
    SELECT f.filename, f.mime_type, f.data
      FROM project_files f
     WHERE f.resource_id = ${id}
       AND EXISTS (SELECT 1 FROM project_documents d WHERE d.resource_id = f.resource_id)`;
  if (!file) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const inline = INLINE.has(file.mime_type);
  const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": inline ? file.mime_type : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Content-Length": String(file.data.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Chrome's PDF viewer renders blank under a sandbox CSP, so PDFs skip that one directive.
      "Content-Security-Policy": `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'${
        file.mime_type === "application/pdf" ? "" : "; sandbox"
      }`,
    },
  });
}
