import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Flame, Briefcase, HardHat, ArrowRight, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { requestEmployeeAccess } from "@/lib/employee-access.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "התחברות | י. אשל בטיחות" }] }),
  component: AuthPage,
});

type View = "chooser" | "owner" | "employee" | "employee-pending";

function AuthPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>("chooser");
  const [pendingMessage, setPendingMessage] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background px-4 py-12"
      dir="rtl"
    >
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
            <Flame className="h-7 w-7 text-primary" fill="currentColor" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-medium text-foreground">י. אשל בטיחות</h1>
            <p className="mt-1 text-sm text-muted-foreground">מערכת ניהול פנימית</p>
          </div>
        </div>

        {view === "chooser" && <Chooser onPick={setView} />}
        {view === "owner" && <OwnerForm onBack={() => setView("chooser")} />}
        {view === "employee" && (
          <EmployeeForm
            onBack={() => setView("chooser")}
            onPending={(msg) => {
              setPendingMessage(msg);
              setView("employee-pending");
            }}
          />
        )}
        {view === "employee-pending" && (
          <EmployeePending
            message={pendingMessage}
            onBack={() => setView("chooser")}
          />
        )}
      </div>
    </div>
  );
}

function Chooser({ onPick }: { onPick: (v: View) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <button
        onClick={() => onPick("owner")}
        className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6 text-right transition-all hover:border-primary hover:shadow-md"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <Briefcase className="h-6 w-6 text-primary" strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="text-lg font-medium text-foreground">כניסה לבעל העסק</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            גישה מלאה לניהול המערכת, העובדים וההרשאות.
          </p>
        </div>
        <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
          המשך <ArrowRight className="h-4 w-4 rotate-180" />
        </span>
      </button>

      <button
        onClick={() => onPick("employee")}
        className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6 text-right transition-all hover:border-primary hover:shadow-md"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary/10">
          <HardHat className="h-6 w-6 text-secondary" strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="text-lg font-medium text-foreground">כניסה לעובדי י. אשל</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            הזן שם ואימייל — המנהל יאשר את הכניסה.
          </p>
        </div>
        <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
          המשך <ArrowRight className="h-4 w-4 rotate-180" />
        </span>
      </button>
    </div>
  );
}

function OwnerForm({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
      toast.success("התחברת בהצלחה");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={onBack}
          className="mb-1 flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="h-3 w-3" /> חזרה
        </button>
        <CardTitle>כניסה — בעל העסק</CardTitle>
        <CardDescription>הזן את פרטי המשתמש שלך.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="אימייל" id="ownerEmail">
            <Input
              id="ownerEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              dir="ltr"
            />
          </Field>
          <Field label="סיסמה" id="ownerPassword">
            <div className="relative">
              <Input
                id="ownerPassword"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                dir="ltr"
                className="pl-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </Field>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "טוען..." : "התחברות"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EmployeeForm({
  onBack,
  onPending,
}: {
  onBack: () => void;
  onPending: (message: string) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await requestEmployeeAccess({
        data: {
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (result.status === "ok") {
        toast.success("מתחבר...");
        window.location.href = result.actionLink;
        return;
      }
      onPending(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={onBack}
          className="mb-1 flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="h-3 w-3" /> חזרה
        </button>
        <CardTitle>כניסת עובד י. אשל</CardTitle>
        <CardDescription>
          הזן שם מלא ואימייל. אם עדיין אין לך אישור — המנהל יאשר את בקשתך.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="שם מלא" id="empName">
            <Input
              id="empName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              maxLength={100}
              autoComplete="name"
            />
          </Field>
          <Field label="אימייל" id="empEmail">
            <Input
              id="empEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              dir="ltr"
            />
          </Field>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "שולח..." : "כניסה / שליחת בקשה"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EmployeePending({
  message,
  onBack,
}: {
  message: string;
  onBack: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>הבקשה נשלחה</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="w-full" onClick={onBack}>
          חזרה למסך הכניסה
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
