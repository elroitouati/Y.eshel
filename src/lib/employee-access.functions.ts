import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type EmployeeAccessResult =
  | { status: "pending"; message: string }
  | { status: "suspended"; message: string }
  | { status: "ok"; actionLink: string };

export const requestEmployeeAccess = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        fullName: z.string().trim().min(1).max(100),
        email: z.string().trim().email().max(255),
        redirectTo: z.string().url(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<EmployeeAccessResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();

    // Look up existing profile by email
    const { data: existing, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, status, full_name")
      .eq("email", email)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);

    if (!existing) {
      // Create a new pending employee via admin API
      const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: data.fullName },
      });
      if (cErr || !created?.user) throw new Error(cErr?.message ?? "שגיאה ביצירת חשבון");

      // The handle_new_user trigger already creates a profile with status=pending.
      // Ensure name is set (in case metadata race).
      await supabaseAdmin
        .from("profiles")
        .update({ full_name: data.fullName, status: "pending", email })
        .eq("id", created.user.id);

      return {
        status: "pending",
        message: "הבקשה נשלחה למנהל. תוכל להיכנס למערכת מיד לאחר האישור.",
      };
    }

    if (existing.status === "pending") {
      // Refresh name if changed
      if (existing.full_name !== data.fullName) {
        await supabaseAdmin
          .from("profiles")
          .update({ full_name: data.fullName })
          .eq("id", existing.id);
      }
      return {
        status: "pending",
        message: "הבקשה שלך עדיין ממתינה לאישור המנהל.",
      };
    }

    if (existing.status === "suspended") {
      return {
        status: "suspended",
        message: "החשבון הושהה. פנה למנהל המערכת.",
      };
    }

    // Active — generate a magic link to sign the user in immediately.
    const { data: link, error: lErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: data.redirectTo },
    });
    if (lErr || !link?.properties?.action_link) {
      throw new Error(lErr?.message ?? "שגיאה ביצירת קישור כניסה");
    }

    return { status: "ok", actionLink: link.properties.action_link };
  });
