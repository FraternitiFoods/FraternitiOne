import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatOnboardingCode } from "@/lib/onboarding/ids";
import { nextActionLabel } from "@/lib/onboarding/format";
import { JOURNEY_STEPS, welcomeAction, welcomeJourney } from "@/lib/onboarding/welcome-steps";
import { WELCOME_VIDEOS } from "@/lib/onboarding/welcome-videos";
import { YoutubeFacade } from "@/components/youtube-facade";
import { Rangoli } from "@/components/onboarding-ui/decor";
import { CodeChip } from "@/components/onboarding-ui/page-header";
import { VideoCard } from "@/components/onboarding-ui/video-card";
import { NextStepsCard, type JourneyItem } from "@/components/onboarding-ui/next-steps-card";

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

  const action = welcomeAction(onboarding.onboardingStatus);

  // Captions reuse the design's own wording: the Welcome step is where they are, the
  // first step still ahead is "Up next", anything after it is "Then".
  const journey = welcomeJourney(onboarding.onboardingStatus);
  const steps: JourneyItem[] = JOURNEY_STEPS.map((step, i) => {
    const state = journey[i]!;
    const firstAhead = journey.findIndex((s, idx) => idx > 0 && s !== "done");
    const caption =
      i === 0 ? "You are here" : state === "done" ? undefined : i === firstAhead ? "Up next" : "Then";
    return { key: step.key, title: step.title, state, caption };
  });

  return (
    <div className="relative">
      <Rangoli />

      <div className="relative z-10 space-y-12">
        <section>
          <CodeChip>
            {formatOnboardingCode(onboarding.seq)} · {onboarding.brand} {onboarding.proposedLocation}
          </CodeChip>
          <h1 className="ob-display mt-6 text-[2.5rem] leading-[1.08] font-semibold tracking-[-0.02em] text-balance text-[var(--ob-green)] sm:text-6xl xl:text-7xl">
            Welcome,{" "}
            <span className="relative inline-block font-medium italic">
              {user.name}!
              <svg
                viewBox="0 0 300 14"
                preserveAspectRatio="none"
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-2.5 h-3.5 w-full"
              >
                <path
                  d="M2 9 C 30 2, 50 14, 80 7 S 130 3, 160 9 S 220 14, 250 6 S 285 4, 298 8"
                  stroke="#E58A1F"
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </span>
          </h1>
          <p className="mt-7 max-w-[35rem] text-lg leading-relaxed text-[var(--ob-text-2)]">
            We&apos;re glad to have you with us. Everything you need to begin your franchise journey is right here.
          </p>
        </section>

        <section aria-labelledby="intro-videos">
          <div className="flex items-center gap-4">
            <h2 id="intro-videos" className="ob-display text-[26px] font-semibold text-[var(--ob-green)]">
              Get started
            </h2>
            <div aria-hidden className="h-px flex-1 bg-[var(--ob-green)]/18" />
          </div>

          {/* Portrait video cards sit beside the dark Next-steps card; everything stacks on narrow screens. */}
          <div className="mt-6 flex flex-wrap items-stretch gap-6">
            {WELCOME_VIDEOS.map((video) => (
              <VideoCard key={video.title} title={video.title} description={video.description}>
                <YoutubeFacade title={video.title} youtubeId={video.youtubeId} vertical={video.vertical} />
              </VideoCard>
            ))}

            <NextStepsCard message={nextActionLabel(onboarding)} steps={steps} action={action} />
          </div>
        </section>
      </div>
    </div>
  );
}
