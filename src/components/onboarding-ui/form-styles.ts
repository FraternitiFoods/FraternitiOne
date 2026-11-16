/**
 * Class overrides that re-skin the shared shadcn `Input` / `Label` inside the
 * franchisee portal (twMerge in `cn` makes these win over the defaults), so the
 * staff app's inputs are untouched.
 */
export const OB_INPUT_CLASS =
  "h-11 rounded-xl border-[var(--ob-green)]/25 bg-white px-3.5 text-[15px] text-[var(--ob-text)] placeholder:text-[var(--ob-muted)] focus-visible:border-[var(--ob-green)] focus-visible:ring-[var(--ob-saffron)]/40 disabled:bg-[var(--ob-bg)] disabled:opacity-70 md:text-[15px]";

export const OB_LABEL_CLASS = "text-sm font-semibold text-[var(--ob-green)]";

/** Native `<input type="file">` (payment receipt). */
export const OB_FILE_INPUT_CLASS =
  "ob-focus block w-full rounded-xl border border-[var(--ob-green)]/25 bg-white p-2 text-sm text-[var(--ob-text-2)] file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border-0 file:bg-[var(--ob-green)] file:px-4 file:text-sm file:font-bold file:text-[var(--ob-cream)]";
