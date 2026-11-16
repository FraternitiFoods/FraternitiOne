import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, humanize } from "@/lib/format";

type RecentEmail = {
  id: string;
  templateKey: string;
  to: string;
  sentAt: Date;
  status: string;
};

export function RecentEmailsCard({
  emails,
  title = "Latest Emails Sent",
  subtitle,
}: {
  emails: RecentEmail[];
  title?: string;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent>
        {emails.length === 0 ? (
          <p className="text-sm text-muted-foreground">No emails sent yet.</p>
        ) : (
          <div className="divide-y">
            {emails.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <div>
                  <div className="font-medium">{humanize(e.templateKey)}</div>
                  <div className="text-muted-foreground">
                    to {e.to} · {formatDateTime(e.sentAt)}
                  </div>
                </div>
                <Badge variant="outline">{e.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
