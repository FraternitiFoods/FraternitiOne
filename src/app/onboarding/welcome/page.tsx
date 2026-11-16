import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "cn";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { nextActionLabel } from "@/lib/onboarding/format";
import { WELCOME_STEPS, currentWelcomeStepIndex, welcomeAction } from "@/lib/onboarding/welcome-steps";
import { WELCOME_VIDEOS } from "@/lib/onboarding/welcome-videos";
import { YoutubeFacade } from "@/components/youtube-facade";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * First page a franchisee sees after login (landingPathForRole). Kept to ONE
 * small query on purpose: the layout's requireUser() already resolved the
 * session, and everything here derives from a few scalar columns. No files,
 * emails or KYC rows — those belong to the Progress page.
 */
export default async function OnboardingWelcomePage() {
  const user = await requireUser();

  // Layout already guarantees this exists and isn't LOI_COMPLETE.
  const onboarding = await db.storeOnboarding.findUniqueOrThrow({
    where: { franchiseeUserId: user.id },
    relationLoadStrategy: "join",
    select: {
      seq: true,
      brand: true,
      proposedLocation: true,
      onboardingStatus: true,
      kycStatus: true,
      paymentStatus: true,
    },
  });

  const currentIndex = currentWelcomeStepIndex(onboarding.onboardingStatus);
  const action = welcomeAction(onboarding.onboardingStatus);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {user.name}!</h1>
        <p className="text-sm text-muted-foreground">
          {formatOnboardingCode(onboarding.seq)} — {onboarding.brand} {onboarding.proposedLocation}
        </p>
      </div>

      <section aria-labelledby="intro-videos" className="space-y-3">
        <h2 id="intro-videos" className="text-base font-semibold">
          Get started
        </h2>
        {/* Cards share one top edge and sit side by side; vertical (9:16) ones are capped narrow so the row stays short enough to see in one screen. */}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-8">
          {WELCOME_VIDEOS.map((video) => (
            <div key={video.title} className={cn("w-full space-y-2", video.vertical ? "max-w-[15rem]" : "max-w-md")}>
              <YoutubeFacade title={video.title} youtubeId={video.youtubeId} vertical={video.vertical} />
              <div>
                <div className="text-sm font-medium">{video.title}</div>
                {video.description && <p className="text-xs text-muted-foreground">{video.description}</p>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">{nextActionLabel(onboarding)}</p>
          <ol className="space-y-3">
            {WELCOME_STEPS.map((step, i) => {
              const done = i < currentIndex;
              const current = i === currentIndex;
              return (
                <li key={step.key} className="flex gap-3" aria-current={current ? "step" : undefined}>
                  <span
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                      done && "bg-primary text-primary-foreground",
                      current && "bg-primary/15 text-primary ring-2 ring-primary",
                      !done && !current && "bg-muted text-muted-foreground"
                    )}
                  >
                    {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
                  </span>
                  <div>
                    <div className={cn("text-sm font-medium", !done && !current && "text-muted-foreground")}>
                      {step.title}
                      {done && <span className="sr-only"> (done)</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <Button nativeButton={false} render={<Link href={action.href}>{action.label}</Link>} />
        </CardContent>
      </Card>
    </div>
  );
}
