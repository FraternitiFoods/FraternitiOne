import { Card, CardContent } from "@/components/ui/card";
import { ProgressBar } from "./progress-bar";
import { STATUS_BADGE_CLASSES, STATUS_LABELS, type StatusCounts } from "./types";

export function SummaryCard({ counts, progressPercent }: { counts: StatusCounts; progressPercent: number }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Overall progress</span>
          <span className="text-lg font-semibold">{progressPercent.toFixed(1)}%</span>
        </div>
        <ProgressBar percent={progressPercent} className="h-2.5" />
        <div className="flex flex-wrap gap-2 pt-1">
          <StatusCountChip status="NOT_STARTED" count={counts.notStarted} />
          <StatusCountChip status="IN_PROGRESS" count={counts.inProgress} />
          <StatusCountChip status="COMPLETED" count={counts.completed} />
          <StatusCountChip status="NOT_REQUIRED" count={counts.notRequired} />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusCountChip({ status, count }: { status: keyof typeof STATUS_LABELS; count: number }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}>
      {STATUS_LABELS[status]}: {count}
    </span>
  );
}
