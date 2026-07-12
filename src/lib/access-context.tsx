import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Flame, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { getMyAccess, type AccessContext } from "@/lib/access.functions";
import { Button } from "@/components/ui/button";

const Ctx = createContext<AccessContext | null>(null);

export function useAccess(): AccessContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccess must be used within AccessGate");
  return v;
}

export function AccessGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["access", "me"],
    queryFn: () => getMyAccess(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 4,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  // Track whether an auth session actually exists, to distinguish
  // transient fetch failures from real sign-outs.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setHasSession(!!data.session);
    }
    check();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setHasSession(!!session);
      if (event === "TOKEN_REFRESHED") {
        queryClient.invalidateQueries({ queryKey: ["access", "me"] });
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  // Auto-refetch when the browser regains connectivity.
  useEffect(() => {
    function onOnline() {
      refetch();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refetch]);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    // If there is no session at all, the user really is signed out.
    if (hasSession === false) {
      return (
        <BlockedScreen
          title="ההתחברות פגה"
          message="יש להתחבר מחדש כדי להמשיך."
          onSignOut={handleSignOut}
        />
      );
    }

    // Transient error — session still valid. Offer retry, do NOT force logout.
    return (
      <BlockedScreen
        title="בעיית תקשורת זמנית"
        message="לא הצלחנו לטעון את פרטי החשבון. ייתכן שמדובר בהפרעה זמנית ברשת."
        primaryLabel={isFetching ? "טוען..." : "נסה שוב"}
        primaryDisabled={isFetching}
        onPrimary={() => refetch()}
        onSignOut={handleSignOut}
      />
    );
  }

  if (!data.isAdmin && data.status !== "active") {
    return (
      <BlockedScreen
        title={
          data.status === "pending"
            ? "החשבון שלך ממתין לאישור מנהל"
            : "החשבון שלך הושהה"
        }
        message={
          data.status === "pending"
            ? "לאחר אישור המנהל תוכל להיכנס למערכת. נשלח אליך עדכון כאשר החשבון יאושר."
            : "פנה למנהל המערכת לקבלת פרטים נוספים."
        }
        onSignOut={handleSignOut}
      />
    );
  }

  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

function BlockedScreen({
  title,
  message,
  onSignOut,
  primaryLabel,
  primaryDisabled,
  onPrimary,
}: {
  title: string;
  message: string;
  onSignOut: () => void;
  primaryLabel?: string;
  primaryDisabled?: boolean;
  onPrimary?: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4" dir="rtl">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
          <Flame className="h-7 w-7 text-primary" fill="currentColor" strokeWidth={1.5} />
        </div>
        <h1 className="text-xl font-medium text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {onPrimary && (
            <Button onClick={onPrimary} disabled={primaryDisabled}>
              {primaryLabel ?? "נסה שוב"}
            </Button>
          )}
          <Button variant="outline" onClick={onSignOut}>
            התנתקות
          </Button>
        </div>
      </div>
    </div>
  );
}
