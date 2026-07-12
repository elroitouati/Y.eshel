import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X, UserPlus, ArrowLeft, Inbox } from "lucide-react";

import { useAccess } from "@/lib/access-context";
import {
  listPendingUsers,
  setUserStatus,
  type PendingUser,
} from "@/lib/users.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "דשבורד | י. אשל בטיחות" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const access = useAccess();

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-medium text-foreground">
          שלום{access.fullName ? `, ${access.fullName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          מבט מהיר על הפעילות במערכת.
        </p>
      </div>

      {access.isAdmin && <PendingRequestsCard />}
    </div>
  );
}

function PendingRequestsCard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["users", "pending"],
    queryFn: () => listPendingUsers(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["users", "pending"] });
    queryClient.invalidateQueries({ queryKey: ["users", "list"] });
  };

  const mutation = useMutation({
    mutationFn: (v: { userId: string; status: "active" | "suspended" }) =>
      setUserStatus({ data: v }),
    onSuccess: (_d, v) => {
      invalidate();
      toast.success(v.status === "active" ? "הבקשה אושרה" : "הבקשה נדחתה");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "שגיאה"),
  });

  const items = query.data ?? [];
  const count = items.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">בקשות ממתינות</CardTitle>
              <CardDescription>עובדים שממתינים לאישורך</CardDescription>
            </div>
          </div>
          {count > 0 && (
            <Badge className="bg-primary text-primary-foreground hover:bg-primary">
              {count}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">טוען...</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/60" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">אין בקשות ממתינות כרגע.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.slice(0, 5).map((u) => (
              <PendingRow
                key={u.id}
                user={u}
                onApprove={() =>
                  mutation.mutate({ userId: u.id, status: "active" })
                }
                onReject={() =>
                  mutation.mutate({ userId: u.id, status: "suspended" })
                }
                disabled={mutation.isPending}
              />
            ))}
          </ul>
        )}

        {items.length > 0 && (
          <div className="mt-4 flex justify-end">
            <Button asChild variant="ghost" size="sm">
              <Link to="/users">
                כל הבקשות <ArrowLeft className="mr-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingRow({
  user,
  onApprove,
  onReject,
  disabled,
}: {
  user: PendingUser;
  onApprove: () => void;
  onReject: () => void;
  disabled: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {user.full_name ?? "ללא שם"}
        </p>
        <p dir="ltr" className="truncate text-right text-xs text-muted-foreground">
          {user.email ?? "—"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" onClick={onApprove} disabled={disabled}>
          <Check className="ml-1 h-4 w-4" /> אשר
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onReject}
          disabled={disabled}
        >
          <X className="ml-1 h-4 w-4" /> דחה
        </Button>
      </div>
    </li>
  );
}
