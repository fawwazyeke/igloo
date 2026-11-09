import { cookies } from "next/headers";
import { agentContext, memberBySession, sharedFile } from "@/lib/store";
import { officeThumbnail } from "@/lib/office-thumbnail";

const types = {
  text: "text/plain; charset=utf-8",
  pdf: "application/pdf",
  slides: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  document: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const securityHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; sandbox",
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("project") ?? "";
  const token = searchParams.get("token");
  const projectId = token !== null ? (await agentContext(token))?.project.id :
    /^[a-z0-9-]{1,60}$/.test(slug)
      ? (await memberBySession(slug, (await cookies()).get(`gm_${slug}`)?.value))?.project_id
      : undefined;
  const notFound = () => new Response("Not found", { status: 404, headers: securityHeaders });
  if (!projectId) return notFound();
  const file = await sharedFile(projectId, (await params).id);
  if (!file || file.kind === "link") return notFound();
  if (searchParams.get("thumbnail") === "1") {
    if (file.kind !== "slides" && file.kind !== "document") return notFound();
    const thumbnail = await officeThumbnail(file.bytes).catch(() => null);
    if (!thumbnail) return notFound();
    return new Response(new Uint8Array(thumbnail.image), {
      headers: { ...securityHeaders, "content-type": thumbnail.type },
    });
  }
  const preview = searchParams.get("preview") === "1" && (file.kind === "text" || file.kind === "pdf");
  const disposition = preview ? "inline" : "attachment";
  const encodedName = encodeURIComponent(file.name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16)}`);
  if (preview && file.kind === "text") {
    const text = new TextDecoder().decode(file.bytes.subarray(0, 32 * 1024));
    return new Response(text + (file.size > 32 * 1024 ? "\n… preview truncated" : ""), {
      headers: { ...securityHeaders, "content-type": types.text, "content-disposition": disposition },
    });
  }
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      ...securityHeaders,
      "content-type": types[file.kind],
      "content-disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
    },
  });
}
