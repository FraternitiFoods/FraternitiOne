import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canReviewKyc, canReviewPayment, canPrepareLoi } from "@/lib/permissions";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { formatMoney } from "@/lib/onboarding/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";

type Tab = "kyc" | "payment" | "loi";

export default async function ReviewsPage({ searchParams }: PageProps<"/reviews">) {
  const user = await requireUser();
  const search = await searchParams;

  const tabs: { key: Tab; label: string; visible: boolean }[] = [
    { key: "kyc", label: "KYC", visible: canReviewKyc(user) },
    { key: "payment", label: "Payment", visible: canReviewPayment(user) },
    { key: "loi", label: "LOI Prep", visible: canPrepareLoi(user) },
  ];
  const visibleTabs = tabs.filter((t) => t.visible);
  if (visibleTabs.length === 0) {
    redirect("/dashboard");
  }

  const requestedTab = typeof search.tab === "string" ? (search.tab as Tab) : undefined;
  const activeTab = visibleTabs.find((t) => t.key === requestedTab)?.key ?? visibleTabs[0].key;

  let items: {
    id: string;
    seq: number;
    brand: string;
    proposedLocation: string;
    extra: string;
    href: string;
  }[] = [];

  if (activeTab === "kyc") {
    const rows = await db.storeOnboarding.findMany({
      where: { kycStatus: "SUBMITTED" },
      orderBy: { updatedAt: "asc" },
    });
    items = rows.map((o) => ({
      id: o.id,
      seq: o.seq,
      brand: o.brand,
      proposedLocation: o.proposedLocation,
      extra: `Entity: ${o.entityType}`,
      href: `/reviews/kyc/${o.id}`,
    }));
  } else if (activeTab === "payment") {
    const rows = await db.storeOnboarding.findMany({
      where: { paymentStatus: "SUBMITTED" },
      orderBy: { updatedAt: "asc" },
      include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    items = rows.map((o) => ({
      id: o.id,
      seq: o.seq,
      brand: o.brand,
      proposedLocation: o.proposedLocation,
      extra: o.payments[0] ? `Declared: ${formatMoney(o.payments[0].declaredAmount)}` : "",
      href: `/reviews/payment/${o.id}`,
    }));
  } else {
    const rows = await db.storeOnboarding.findMany({
      where: {
        kycStatus: "ACCEPTED",
        paymentStatus: "ACCEPTED",
        onboardingStatus: { in: ["UNDER_REVIEW", "READY_FOR_SIGNATURE"] },
      },
      orderBy: { updatedAt: "asc" },
    });
    items = rows.map((o) => ({
      id: o.id,
      seq: o.seq,
      brand: o.brand,
      proposedLocation: o.proposedLocation,
      extra: formatMoney(o.expectedAmount),
      href: `/store-onboarding/${o.id}`, // LOI prep actions live on the onboarding detail page (step 5)
    }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reviews</h1>
        <p className="text-sm text-muted-foreground">KYC, payment and LOI-prep review queues.</p>
      </div>

      <div className="flex gap-2 border-b">
        {visibleTabs.map((t) => (
          <Link
            key={t.key}
            href={`/reviews?tab=${t.key}`}
            className={cn(
              "border-b-2 px-3 py-2 text-sm",
              activeTab === t.key
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting in this queue.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="block rounded-md border p-3 text-sm hover:bg-muted"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {formatOnboardingCode(item.seq)} — {item.brand} {item.proposedLocation}
                </span>
                <Badge variant="outline">{item.extra}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
