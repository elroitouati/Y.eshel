import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ManagedUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  status: "pending" | "active" | "suspended";
  created_at: string;
  is_admin: boolean;
  permissions: {
    can_projects: boolean;
    can_quotes: boolean;
    can_safety: boolean;
    can_assistant: boolean;
  };
};

export type PendingUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
};

async function assertAdmin(context: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  userId: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ManagedUser[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [profilesRes, rolesRes, permsRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, status, created_at")
        .order("created_at", { ascending: false }),
      supabaseAdmin.from("user_roles").select("user_id, role").eq("role", "admin"),
      supabaseAdmin
        .from("user_permissions")
        .select("user_id, can_projects, can_quotes, can_safety, can_assistant"),
    ]);

    if (profilesRes.error) throw new Error(profilesRes.error.message);

    const admins = new Set((rolesRes.data ?? []).map((r: { user_id: string }) => r.user_id));

    const permMap = new Map(
      (permsRes.data ?? []).map((p: { user_id: string } & ManagedUser["permissions"]) => [p.user_id, p]),
    );

    return (profilesRes.data ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      status: p.status as ManagedUser["status"],
      created_at: p.created_at,
      is_admin: admins.has(p.id),
      permissions: permMap.get(p.id) ?? {
        can_projects: false,
        can_quotes: false,
        can_safety: false,
        can_assistant: false,
      },
    }));
  });

export const setUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        userId: z.string().uuid(),
        status: z.enum(["pending", "active", "suspended"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ status: data.status })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setUserAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ userId: z.string().uuid(), isAdmin: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.isAdmin) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.userId, role: "admin" });
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    } else {
      if (data.userId === context.userId) {
        throw new Error("לא ניתן להסיר את הרשאת המנהל של עצמך");
      }
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", "admin");
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const setUserPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        userId: z.string().uuid(),
        can_projects: z.boolean(),
        can_quotes: z.boolean(),
        can_safety: z.boolean(),
        can_assistant: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("user_permissions").upsert({
      user_id: data.userId,
      can_projects: data.can_projects,
      can_quotes: data.can_quotes,
      can_safety: data.can_safety,
      can_assistant: data.can_assistant,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPendingUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingUser[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return (data ?? []) as PendingUser[];
  });
