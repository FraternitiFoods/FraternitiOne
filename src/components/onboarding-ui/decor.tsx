import { cn } from "cn";

/** Rangoli / lotus top-right decoration (SVG copied from design-reference/B-*.dc.html). */
export function Rangoli({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 360 360"
      fill="none"
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute -top-16 -right-16 z-0 size-56 sm:-top-[70px] sm:-right-[70px] sm:size-[300px]",
        className
      )}
    >
      <circle cx="180" cy="180" r="172" stroke="#E58A1F" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="2 10" strokeLinecap="round" />
      <circle cx="180" cy="180" r="132" stroke="#E58A1F" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="2 8" strokeLinecap="round" />
      <g fill="#F2C57C" fillOpacity="0.85">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <ellipse key={deg} cx="180" cy="108" rx="15" ry="40" transform={deg ? `rotate(${deg} 180 180)` : undefined} />
        ))}
      </g>
      <circle cx="180" cy="180" r="24" fill="#E58A1F" />
    </svg>
  );
}

const LEAF_PATHS = (
  <>
    <path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15" />
    <path d="M5 19c3-5 6-8 10-10" />
  </>
);

/** Faint leaf watermark on the dark-green cards. */
export function LeafWatermark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FAF5EA"
      strokeWidth="0.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("pointer-events-none absolute opacity-[0.12]", className)}
    >
      {LEAF_PATHS}
    </svg>
  );
}

/** Small leaf icon inside the green chip. */
export function LeafIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {LEAF_PATHS}
    </svg>
  );
}
