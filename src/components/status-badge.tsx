import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, type ClientStatus } from "@/lib/status";

export function StatusBadge({ status }: { status: ClientStatus }) {
  return (
    <Badge variant={status} className="rounded-full font-medium">
      <span className="mr-1.5 size-1.5 rounded-full bg-current" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </Badge>
  );
}
