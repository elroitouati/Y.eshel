import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const DOCUMENT_CATEGORIES = [
  "commissioner_directives",
  "private_pool_safety",
  "objections",
  "server_room_guidelines",
  "organization_plan_materials",
  "financing_calculation",
  "educational_institutions",
  "inspection_institute_forms",
  "fire_risk_survey_procedure",
  "building_structure_classification",
  "fire_extinguishing_publications",
  "fire_risk_survey_course",
  "standards_institute_courses",
  "planning_building_regulations",
  "israeli_standards",
  "nfpa_standards",
  "sol_safety",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export type ProcessingStatus =
  | "pending"
  | "processing"
  | "processed"
  | "unsupported"
  | "error";

export type KnowledgeDocument = {
  id: string;
  title: string;
  category: DocumentCategory;
  file_path: string;
  file_type: string;
  file_size: number | null;
  description: string | null;
  tags: string[];
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  processed: boolean;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  processed_at: string | null;
};

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KnowledgeDocument[]> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // PostgREST silently caps a single response at ~1000 rows regardless of
    // .range(). Paginate in batches of 1000 to fetch ALL rows.
    const PAGE_SIZE = 1000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = [];
    let from = 0;
    // Safety ceiling to avoid an infinite loop if PostgREST ever misbehaves.
    const HARD_MAX_PAGES = 100;
    for (let page = 0; page < HARD_MAX_PAGES; page++) {
      const { data: batch, error } = await supabaseAdmin
        .from("documents")
        .select("*")
        .order("uploaded_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      if (!batch || batch.length === 0) break;
      data.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    const uploaderIds = Array.from(
      new Set((data ?? []).map((d) => d.uploaded_by).filter(Boolean) as string[]),
    );
    let nameMap = new Map<string, string>();
    if (uploaderIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", uploaderIds);
      nameMap = new Map(
        (profs ?? []).map((p) => [p.id, p.full_name ?? p.email ?? ""]),
      );
    }

    return (data ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category as DocumentCategory,
      file_path: d.file_path,
      file_type: d.file_type,
      file_size: (d as { file_size: number | null }).file_size ?? null,
      description: d.description,
      tags: (d.tags as string[]) ?? [],
      uploaded_by: d.uploaded_by,
      uploaded_by_name: d.uploaded_by ? nameMap.get(d.uploaded_by) ?? null : null,
      uploaded_at: d.uploaded_at,
      processed: d.processed,
      processing_status: ((d as { processing_status?: string }).processing_status ?? "pending") as ProcessingStatus,
      processing_error: (d as { processing_error?: string | null }).processing_error ?? null,
      processed_at: (d as { processed_at?: string | null }).processed_at ?? null,
    }));
  });

export const createDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        title: z.string().min(1).max(300),
        category: z.enum(DOCUMENT_CATEGORIES),
        file_path: z.string().min(1),
        file_type: z.string().min(1).max(50),
        file_size: z.number().int().nonnegative().nullable().optional(),
        description: z.string().max(2000).optional().nullable(),
        tags: z.array(z.string().min(1).max(50)).max(30).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error, data: row } = await supabaseAdmin
      .from("documents")
      .insert({
        title: data.title,
        category: data.category,
        file_path: data.file_path,
        file_type: data.file_type,
        file_size: data.file_size ?? null,
        description: data.description ?? null,
        tags: data.tags ?? [],
        uploaded_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: doc, error: fetchErr } = await supabaseAdmin
      .from("documents")
      .select("category, file_path")
      .eq("id", data.id)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!doc) throw new Error("Document not found");

    const { error: storageErr } = await supabaseAdmin.storage
      .from(doc.category)
      .remove([doc.file_path]);
    if (storageErr) {
      // Log but continue with row delete so an orphaned row doesn't block cleanup.
      console.warn("[deleteDocument] storage delete failed:", storageErr.message);
    }

    const { error: delErr } = await supabaseAdmin
      .from("documents")
      .delete()
      .eq("id", data.id);
    if (delErr) throw new Error(delErr.message);
    return { ok: true };
  });

export const createSignedUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        category: z.enum(DOCUMENT_CATEGORIES),
        filename: z.string().min(1).max(300),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const safe = data.filename.replace(/[^\w.\-]+/g, "_");
    const path = `${context.userId}/${Date.now()}_${safe}`;

    const { data: signed, error } = await supabaseAdmin.storage
      .from(data.category)
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path: signed.path, token: signed.token };
  });

export const createSignedDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: doc, error: fetchErr } = await supabaseAdmin
      .from("documents")
      .select("category, file_path, title")
      .eq("id", data.id)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!doc) throw new Error("Document not found");

    const { data: signed, error } = await supabaseAdmin.storage
      .from(doc.category)
      .createSignedUrl(doc.file_path, 60 * 10, { download: doc.title });
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });
