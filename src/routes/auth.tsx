import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Building2, KeyRound, Loader2, MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type AuthSearch = { mode?: "signin" | "signup"; invite?: string; redirect?: string };

function safeRedirect(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    mode: search.mode === "signup" ? "signup" : search.mode === "signin" ? "signin" : undefined,
    invite: typeof search.invite === "string" ? search.invite : undefined,
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ href: safeRedirect(search.redirect) });
  },
  head: () => ({
    meta: [
      { title: "Sign in — Clientbook" },
      {
        name: "description",
        content: "Sign in to Clientbook or create a workspace for your agency.",
      },
      { property: "og:title", content: "Sign in — Clientbook" },
      {
        property: "og:description",
        content: "Sign in to Clientbook or create a workspace for your agency.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const search = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">(
    search.mode ?? (search.invite ? "signup" : "signin"),
  );

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <Link to="/">
          <Brand inverted />
        </Link>
        <div className="max-w-md">
          <p className="font-display text-5xl leading-[1.05] text-sidebar-accent-foreground">
            Every client, every contract, one shared book.
          </p>
          <p className="mt-5 text-sidebar-foreground/70">
            Clientbook keeps your agency's leads, active accounts and paperwork in one calm place
            your whole team can trust.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">Built for teams of 2 to 50.</p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-10 inline-block lg:hidden">
            <Brand />
          </Link>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
            <TabsList className="mb-8 grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>
          </Tabs>
          {mode === "signin" ? (
            <SignInForm redirectTo={safeRedirect(search.redirect)} />
          ) : (
            <SignUpForm initialInvite={search.invite ?? ""} />
          )}
        </div>
      </main>
    </div>
  );
}

function SignInForm({ redirectTo }: { redirectTo: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      setError(
        error.message.toLowerCase().includes("email not confirmed")
          ? "Please confirm your email first — check your inbox for the link."
          : error.message.toLowerCase().includes("invalid")
            ? "That email and password don't match."
            : error.message,
      );
      return;
    }
    navigate({ href: redirectTo, replace: true });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <h1 className="font-display text-4xl">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to your agency's client book.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="signin-email">Email</Label>
        <Input
          id="signin-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signin-password">Password</Label>
        <Input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" size="lg" disabled={loading}>
        {loading && <Loader2 className="animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}

function SignUpForm({ initialInvite }: { initialInvite: string }) {
  const [path, setPath] = useState<"create" | "join">(initialInvite ? "join" : "create");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInvite.toUpperCase());
  const [inviteCompany, setInviteCompany] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (path !== "join") return;
    const code = inviteCode.trim();
    if (code.length < 6) {
      setInviteCompany(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("lookup_invite", { _code: code });
      if (!cancelled) setInviteCompany(data ?? null);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [inviteCode, path]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setLoading(true);
    if (path === "join") {
      const { data } = await supabase.rpc("lookup_invite", { _code: inviteCode.trim() });
      if (!data) {
        setLoading(false);
        setError("That invite code isn't valid or has already been used.");
        return;
      }
    }
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth`,
        data: {
          full_name: fullName.trim(),
          ...(path === "create"
            ? { company_name: companyName.trim() }
            : { invite_code: inviteCode.trim().toUpperCase() }),
        },
      },
    });
    setLoading(false);
    if (error) {
      setError(
        error.message.toLowerCase().includes("database error")
          ? "We couldn't create your account. If you used an invite code, ask your admin for a new one."
          : error.message,
      );
      return;
    }
    setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <MailCheck className="size-6" />
        </span>
        <h1 className="font-display text-4xl">Check your inbox</h1>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{sentTo}</span>.
          Click it to activate your account, then sign in.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <h1 className="font-display text-4xl">Get started</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start a new workspace, or join your team with an invite code.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Company">
        {(
          [
            { value: "create", label: "Create a company", icon: Building2 },
            { value: "join", label: "Join with a code", icon: KeyRound },
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={path === opt.value}
            onClick={() => setPath(opt.value)}
            className={cn(
              "flex flex-col items-start gap-2 rounded-lg border bg-card p-3 text-left text-sm font-medium transition-colors",
              path === opt.value
                ? "border-primary ring-1 ring-primary"
                : "hover:border-foreground/30",
            )}
          >
            <opt.icon className="size-4 text-primary" />
            {opt.label}
          </button>
        ))}
      </div>

      {path === "create" ? (
        <div className="space-y-2">
          <Label htmlFor="company-name">Company name</Label>
          <Input
            id="company-name"
            required
            maxLength={120}
            placeholder="Northwind Studio"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="invite-code">Invite code</Label>
          <Input
            id="invite-code"
            required
            className="font-mono uppercase tracking-widest"
            placeholder="A1B2C3D4E5"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
          />
          {inviteCompany ? (
            <p className="text-xs text-status-active">You'll join {inviteCompany}.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Ask an admin on your team for a code.</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="full-name">Your name</Label>
        <Input
          id="full-name"
          required
          maxLength={120}
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-email">Work email</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" size="lg" disabled={loading}>
        {loading && <Loader2 className="animate-spin" />}
        {path === "create" ? "Create company" : "Join company"}
      </Button>
    </form>
  );
}
