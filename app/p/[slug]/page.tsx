import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getBoard, memberBySession } from "@/lib/store";
import { publicMember } from "@/lib/core";
import { App, JoinForm } from "./ui";

export const dynamic = "force-dynamic";

export default async function GroupPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ code?: string }> }) {
  const { slug } = await params;
  const { code } = await searchParams;
  const board = await getBoard(slug);
  if (!board) notFound();
  const me = await memberBySession(slug, (await cookies()).get(`gm_${slug}`)?.value);
  const { project } = board;

  if (!me) return <JoinForm slug={slug} name={project.name} context={project.course_or_context} code={/^\d{6}$/.test(code ?? "") ? code : undefined} />;

  // The viewer gets their own agent token and nobody else's; the session token never leaves the server.
  return (
    <App
      slug={slug}
      project={{ name: project.name, course_or_context: project.course_or_context, due_date: project.due_date, brief: project.brief, join_code: project.join_code }}
      me={{ ...publicMember(me), agent_token: me.agent_token }}
      members={board.members}
      tasks={board.tasks}
      decisions={board.decisions}
      activity={board.activity}
      latestNotes={board.latestNotes}
    />
  );
}
