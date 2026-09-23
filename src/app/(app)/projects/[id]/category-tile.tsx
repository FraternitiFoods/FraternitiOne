import { type StageState } from "@/lib/lifecycle-stage-status";
import { ProgressTile } from "./progress-tile";

/** Tapping a tile navigates to its own page (/projects/[id]/categories/[category])
 * with the trade/department's task list — mirrors StageTile's drill-down. */
export function CategoryTile({ category, total, completed, state, projectId, backHref }: {
  category: string;
  total: number;
  completed: number;
  state: StageState;
  projectId: string;
  /** Where the detail page's "← Back" link (and its task actions) should
   * return to — defaults to the project page there, but callers that embed
   * this tile elsewhere (e.g. /progress) pass their own URL through so the
   * user lands back where they actually came from. */
  backHref?: string;
}) {
  const href = `/projects/${projectId}/categories/${encodeURIComponent(category)}${
    backHref ? `?back=${encodeURIComponent(backHref)}` : ""
  }`;
  return (
    <ProgressTile
      href={href}
      label={category}
      status={state}
      total={total}
      completed={completed}
    />
  );
}
