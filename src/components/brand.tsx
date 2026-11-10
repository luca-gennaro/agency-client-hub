import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md bg-primary font-display text-xl leading-none text-primary-foreground",
        className,
      )}
    >
      C
    </span>
  );
}

export function Brand({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark className={inverted ? "bg-sidebar-primary text-sidebar-primary-foreground" : undefined} />
      <span className="font-display text-2xl leading-none">Clientbook</span>
    </span>
  );
}
