import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canActOnComplaint, canManageComplaintCategory } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { ComplaintList } from "./complaint-list";
import type { Prisma } from "@prisma/client";

export default async function ComplaintsPage(props: PageProps<"/complaints">) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const projectParam = searchParams.project;
  const projectId = typeof projectParam === "string" ? projectParam : undefined;

  // Same isolation rule as the Document Vault / project visibility (NFR-04):
  // a franchisee only ever sees complaints on their own project(s); every
  // internal role sees the full portfolio so they can work their queue.
  const where: Prisma.ComplaintWhereInput = {
    ...(user.role === "FRANCHISEE"
      ? { project: { franchiseeId: user.id }, ...(projectId ? { projectId } : {}) }
      : projectId
        ? { projectId }
        : {}),
  };

  const [complaints, people] = await Promise.all([
    db.complaint.findMany({
      where,
      include: {
        raisedBy: { select: { name: true } },
        assignedTo: { select: { id: true, name: true } },
        project: { select: { id: true, seq: true, brand: true, location: true, franchiseeId: true } },
        comments: {
          include: { author: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      // Portfolio-wide list, not an export — cap the row count so this stays
      // cheap to query/render/serialize as complaints accumulate.
      take: 50,
    }),
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Complaints"
        subtitle="Every complaint raised across the portfolio, by project."
        isFranchisee={user.role === "FRANCHISEE"}
      />

      <ComplaintList
        complaints={complaints.map((complaint) => ({
          id: complaint.id,
          seq: complaint.seq,
          category: complaint.category,
          subject: complaint.subject,
          description: complaint.description,
          priority: complaint.priority,
          status: complaint.status,
          raisedBy: complaint.raisedBy,
          assignedTo: complaint.assignedTo,
          attachmentFileName: complaint.attachmentFileName,
          resolutionDate: complaint.resolutionDate ? complaint.resolutionDate.toISOString() : null,
          createdAt: complaint.createdAt.toISOString(),
          comments: complaint.comments.map((c) => ({
            id: c.id,
            body: c.body,
            createdAt: c.createdAt.toISOString(),
            author: c.author,
          })),
          project: { seq: complaint.project.seq, brand: complaint.project.brand, location: complaint.project.location },
          projectId: complaint.projectId,
          canAct: canActOnComplaint(user, complaint, complaint.project),
          canAssign: canManageComplaintCategory(user, complaint.category),
        }))}
        people={people}
      />
    </div>
  );
}
