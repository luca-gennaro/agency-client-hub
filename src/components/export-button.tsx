import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/current-user";
import { exportAllClients } from "@/lib/crm";

export function ExportClientsButton({ variant = "outline" }: { variant?: ButtonProps["variant"] }) {
  const me = useCurrentUser();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const count = await exportAllClients(me.company.name);
      toast.success(`Exported ${count} client${count === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} onClick={onClick} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <Download />}
      Export all clients
    </Button>
  );
}
