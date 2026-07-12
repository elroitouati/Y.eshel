import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AccessContext = {
  userId: string;
  email: string | null;
  fullName: string | null;
  status: "pending" | "active" | "suspended";
  isAdmin: boolean;
  permissions: {
    can_projects: boolean;
    can_quotes: boolean;
    can_safety: boolean;
    can_assistant: boolean;
  };
};

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccessContext> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [profileRes, rolesRes, permsRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("email, full_name, status")
        .eq("id", userId)
        .maybeSingle(),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
      supabaseAdmin
        .from("user_permissions")
        .select("can_projects, can_quotes, can_safety, can_assistant")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    const isAdmin = (rolesRes.data ?? []).some((r: { role: string }) => r.role === "admin");
    const status = isAdmin
      ? "active"
      : ((profileRes.data?.status ?? "pending") as AccessContext["status"]);

    return {
      userId,
      email: profileRes.data?.email ?? null,
      fullName: profileRes.data?.full_name ?? null,
      status,
      isAdmin,
      permissions: permsRes.data ?? {
        can_projects: false,
        can_quotes: false,
        can_safety: false,
        can_assistant: false,
      },
    };
  });
