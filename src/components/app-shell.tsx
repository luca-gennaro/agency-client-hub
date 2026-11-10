import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { LayoutDashboard, LogOut, Menu, Settings, Users, Contact } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/current-user";
import { permissions } from "@/lib/permissions";
import { displayName } from "@/lib/crm";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

function NavLinks({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const me = useCurrentUser();
  const items = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/clients", label: "Clients", icon: Contact },
    { to: "/team", label: "Team", icon: Users },
    ...(permissions.viewCompanySettings(me.role)
      ? [{ to: "/settings", label: "Company settings", icon: Settings }]
      : []),
  ] as const;

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
        >
          <item.icon className="size-4" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex h-full flex-col gap-8 bg-sidebar p-5 text-sidebar-foreground">
      <Link to="/dashboard" onClick={onNavigate} className="text-sidebar-accent-foreground">
        <Brand inverted />
      </Link>
      <div className="rounded-md border border-sidebar-border px-3 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Company
        </p>
        <p className="truncate text-sm font-medium text-sidebar-accent-foreground">
          {me.company.name}
        </p>
      </div>
      <NavLinks onNavigate={onNavigate} />
      <div className="mt-auto space-y-3 border-t border-sidebar-border pt-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-sidebar-accent-foreground">
            {displayName({ full_name: me.fullName, email: me.email })}
          </p>
          <p className="truncate text-xs text-sidebar-foreground/60">
            {me.role === "admin" ? "Admin" : "Member"} · {me.email}
          </p>
        </div>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-screen lg:block">
        <SidebarBody />
      </aside>
      <header className="flex items-center justify-between border-b bg-card px-4 py-3 lg:hidden">
        <Brand />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 border-none p-0">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SidebarBody onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </header>
      <main className="min-w-0 px-4 py-8 sm:px-8 lg:px-12 lg:py-10">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
