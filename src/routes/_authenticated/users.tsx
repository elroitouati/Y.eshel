import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { MoreHorizontal, ShieldCheck, ShieldOff, UserCheck, UserX, Info } from "lucide-react";

import {
  listUsers,
  setUserAdmin,
  setUserPermissions,
  setUserStatus,
  type ManagedUser,
} from "@/lib/users.functions";
import { useAccess } from "@/lib/access-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "ניהול עובדים | י. אשל בטיחות" }] }),
  component: UsersPage,
});

function UsersPage() {
  const access = useAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (!access.isAdmin) {
    // Non-admin: redirect to dashboard.
    navigate({ to: "/dashboard", replace: true });
    return null;
  }

  const usersQuery = useQuery({
    queryKey: ["users", "list"],
    queryFn: () => listUsers(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users", "list"] });

  const statusMutation = useMutation({
    mutationFn: (v: { userId: string; status: ManagedUser["status"] }) =>
      setUserStatus({ data: v }),
    onSuccess: () => {
      invalidate();
      toast.success("הסטטוס עודכן");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "שגיאה"),
  });

  const adminMutation = useMutation({
    mutationFn: (v: { userId: string; isAdmin: boolean }) => setUserAdmin({ data: v }),
    onSuccess: () => {
      invalidate();
      toast.success("הרשאות המנהל עודכנו");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "שגיאה"),
  });

  const permsMutation = useMutation({
    mutationFn: (v: {
      userId: string;
      can_projects: boolean;
      can_quotes: boolean;
      can_safety: boolean;
      can_assistant: boolean;
    }) => setUserPermissions({ data: v }),
    onSuccess: () => {
      invalidate();
      toast.success("ההרשאות עודכנו");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "שגיאה"),
  });

  const [permsUser, setPermsUser] = useState<ManagedUser | null>(null);

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-medium text-foreground">ניהול עובדים והרשאות</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          אישור עובדים חדשים, ניהול סטטוס והרשאות מודולים.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>הפעלת חשבון מנהל ראשון</AlertTitle>
        <AlertDescription>
          לאחר יצירת החשבון הראשון, יש להפעיל אותו כמנהל דרך מסד הנתונים:
          <code
            className="mt-2 block rounded-md bg-muted px-3 py-2 text-xs text-foreground"
            dir="ltr"
          >
            insert into public.user_roles (user_id, role) values ('&lt;auth-user-id&gt;', 'admin');<br />
            update public.profiles set status='active' where id='&lt;auth-user-id&gt;';
          </code>
        </AlertDescription>
      </Alert>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">שם מלא</TableHead>
              <TableHead className="text-right">אימייל</TableHead>
              <TableHead className="text-right">סטטוס</TableHead>
              <TableHead className="text-right">תפקיד</TableHead>
              <TableHead className="text-right">תאריך הצטרפות</TableHead>
              <TableHead className="text-right">פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  טוען...
                </TableCell>
              </TableRow>
            )}
            {usersQuery.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  אין עובדים רשומים.
                </TableCell>
              </TableRow>
            )}
            {usersQuery.data?.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name ?? "—"}</TableCell>
                <TableCell dir="ltr" className="text-right">
                  {u.email ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={u.status} />
                </TableCell>
                <TableCell>
                  {u.is_admin ? (
                    <Badge className="bg-primary/15 text-foreground hover:bg-primary/15">
                      מנהל
                    </Badge>
                  ) : (
                    <Badge variant="outline">עובד</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString("he-IL")}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {u.status !== "active" && (
                        <DropdownMenuItem
                          onClick={() =>
                            statusMutation.mutate({ userId: u.id, status: "active" })
                          }
                        >
                          <UserCheck className="ml-2 h-4 w-4" /> אשר חשבון
                        </DropdownMenuItem>
                      )}
                      {u.status === "active" && (
                        <DropdownMenuItem
                          onClick={() =>
                            statusMutation.mutate({ userId: u.id, status: "suspended" })
                          }
                        >
                          <UserX className="ml-2 h-4 w-4" /> השהה חשבון
                        </DropdownMenuItem>
                      )}
                      {u.status === "suspended" && (
                        <DropdownMenuItem
                          onClick={() =>
                            statusMutation.mutate({ userId: u.id, status: "active" })
                          }
                        >
                          <UserCheck className="ml-2 h-4 w-4" /> הפעל מחדש
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      {u.is_admin ? (
                        <DropdownMenuItem
                          onClick={() =>
                            adminMutation.mutate({ userId: u.id, isAdmin: false })
                          }
                          disabled={u.id === access.userId}
                        >
                          <ShieldOff className="ml-2 h-4 w-4" /> הסר הרשאת מנהל
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() =>
                            adminMutation.mutate({ userId: u.id, isAdmin: true })
                          }
                        >
                          <ShieldCheck className="ml-2 h-4 w-4" /> הפוך למנהל
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setPermsUser(u)}>
                        ניהול הרשאות מודולים
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <PermissionsDialog
        user={permsUser}
        onClose={() => setPermsUser(null)}
        onSave={(perms) => {
          if (!permsUser) return;
          permsMutation.mutate(
            { userId: permsUser.id, ...perms },
            { onSuccess: () => setPermsUser(null) },
          );
        }}
        saving={permsMutation.isPending}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: ManagedUser["status"] }) {
  if (status === "active")
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">פעיל</Badge>
    );
  if (status === "pending")
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">ממתין לאישור</Badge>
    );
  return <Badge variant="outline">מושהה</Badge>;
}

type Perms = ManagedUser["permissions"];

function PermissionsDialog({
  user,
  onClose,
  onSave,
  saving,
}: {
  user: ManagedUser | null;
  onClose: () => void;
  onSave: (p: Perms) => void;
  saving: boolean;
}) {
  const [state, setState] = useState<Perms | null>(null);
  const current = state ?? user?.permissions ?? null;

  // Sync state when user changes.
  if (user && !state) {
    // Set once when dialog opens.
    // Using inline effect via setTimeout to avoid re-render loop.
    queueMicrotask(() => setState(user.permissions));
  }

  if (!user) return null;

  const modules: { key: keyof Perms; label: string }[] = [
    { key: "can_projects", label: "ניהול פרויקטים" },
    { key: "can_quotes", label: "הצעות מחיר" },
    { key: "can_safety", label: "בטיחות בעבודה" },
    { key: "can_assistant", label: "עוזר חכם" },
  ];

  return (
    <Dialog
      open={!!user}
      onOpenChange={(open) => {
        if (!open) {
          setState(null);
          onClose();
        }
      }}
    >
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>הרשאות מודולים — {user.full_name ?? user.email}</DialogTitle>
          <DialogDescription>
            בחר לאילו מודולים לעובד יש גישה. השינויים ייכנסו לתוקף מיד.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {modules.map((m) => (
            <div
              key={m.key}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <Label htmlFor={m.key} className="font-medium">
                {m.label}
              </Label>
              <Switch
                id={m.key}
                checked={current?.[m.key] ?? false}
                onCheckedChange={(v) =>
                  setState((s) => ({ ...(s ?? user.permissions), [m.key]: v }))
                }
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setState(null);
              onClose();
            }}
          >
            ביטול
          </Button>
          <Button
            onClick={() => current && onSave(current)}
            disabled={!current || saving}
          >
            {saving ? "שומר..." : "שמור"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
