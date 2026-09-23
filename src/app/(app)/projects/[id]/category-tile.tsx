import { type StageState } from "@/lib/lifecycle-stage-status";
import { ProgressTile } from "./progress-tile";

/** Tapping a tile navigates to its own page (/projects/[id]/categories/[category])
 * with the trade/department's task list — mirrors StageTile's drill-down. */
export function CategoryTile({ category, total, completed, state, projectId }: {
  category: string;
  total: number;
  completed: number;
  state: StageState;
  projectId: string;
}) {
  return (
    <ProgressTile
      href={`/projects/${projectId}/categories/${encodeURIComponent(category)}`}
      label={category}
      status={state}
      total={total}
      completed={completed}
    />
  );
}
