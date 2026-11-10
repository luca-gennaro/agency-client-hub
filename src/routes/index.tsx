import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileText, Search, Users } from "lucide-react";
import { Brand } from "@/components/brand";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { ClientStatus } from "@/lib/status";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Clientbook — The simple CRM for small agencies" },
      {
        name: "description",
        content:
          "Track leads and active clients, store contracts and invoices, and share it all with your team.",
      },
      { property: "og:title", content: "Clientbook — The simple CRM for small agencies" },
      {
        property: "og:description",
        content:
          "Track leads and active clients, store contracts and invoices, and share it all with your team.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const sample: { name: string; owner: string; status: ClientStatus }[] = [
  { name: "Harbor & Pine Coffee", owner: "Giulia R.", status: "active" },
  { name: "Okafor Architects", owner: "Marco T.", status: "lead" },
  { name: "Nordlys Outdoor", owner: "Giulia R.", status: "active" },
  { name: "Bellweather Books", owner: "Sam K.", status: "lost" },
  { name: "Fennel Studio", owner: "Marco T.", status: "lead" },
];

const features = [
  {
    icon: Search,
    title: "Find anyone in seconds",
    body: "Search by name, email or phone and filter by lead, active or lost.",
  },
  {
    icon: FileText,
    title: "Paperwork lives with the client",
    body: "Upload contracts and invoices to each client. Anyone on the team can download them.",
  },
  {
    icon: Users,
    title: "Built for your whole team",
    body: "Invite colleagues with a code. Admins manage the company; members manage clients.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Brand />
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link to="/auth" search={{ mode: "signin" }}>
              Sign in
            </Link>
          </Button>
          <Button asChild>
            <Link to="/auth" search={{ mode: "signup" }}>
              Get started
            </Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-20 pt-10 lg:grid-cols-[1fr_1.05fr] lg:pt-16">
          <div>
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              CRM for small agencies
            </p>
            <h1 className="font-display text-6xl leading-[0.98] sm:text-7xl">
              Your client book,
              <br />
              <em className="text-primary">finally shared.</em>
            </h1>
            <p className="mt-6 max-w-md text-lg text-muted-foreground">
              One tidy place for every lead, active account and signed contract — so your whole
              team knows who's who.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/auth" search={{ mode: "signup" }}>
                  Create your company <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/auth" search={{ mode: "signup" }}>
                  I have an invite code
                </Link>
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-3xl bg-paper-grid opacity-60" />
            <div className="overflow-hidden rounded-2xl border bg-card shadow-lift">
              <div className="grid grid-cols-3 divide-x border-b">
                {[
                  { s: "lead" as const, n: 12 },
                  { s: "active" as const, n: 28 },
                  { s: "lost" as const, n: 5 },
                ].map((c) => (
                  <div key={c.s} className="p-4">
                    <StatusBadge status={c.s} />
                    <p className="mt-2 font-display text-4xl">{c.n}</p>
                  </div>
                ))}
              </div>
              <ul className="divide-y">
                {sample.map((c) => (
                  <li key={c.name} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex size-8 items-center justify-center rounded-full bg-secondary font-display text-base">
                      {c.name.charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.owner}</p>
                    </div>
                    <StatusBadge status={c.status} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="border-t bg-card">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-3">
            {features.map((f) => (
              <div key={f.title}>
                <f.icon className="size-5 text-primary" />
                <h2 className="mt-4 font-display text-2xl">{f.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-6 py-8 text-xs text-muted-foreground">
        © {new Date().getFullYear()} Clientbook
      </footer>
    </div>
  );
}
