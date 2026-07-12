// Edge function: process-document
// Extracts text from an uploaded document, chunks it, embeds via Voyage AI,
// and stores the chunks in public.document_chunks.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.11.0";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;
const EMBED_MODEL = "voyage-3";
const EMBED_DIMS = 1024;

const SUPPORTED_TEXT = new Set(["txt", "md", "csv", "log", "json"]);

const CHUNK_CHARS = 2400;
const CHUNK_OVERLAP = 320;
const EMBED_BATCH = 16;
const INSERT_BATCH_SIZE = 50;
const PAGE_YIELD_EVERY = 20;

function sanitizeText(t: string): string {
  // Strip NUL + C0 controls except \t \n \r, plus C1 controls (Postgres rejects NUL in text).
  return t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function truncateErr(msg: string) {
  return msg.length > 500 ? msg.slice(0, 500) : msg;
}

function normalizeWhitespace(t: string) {
  return t
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkText(text: string): string[] {
  const clean = normalizeWhitespace(text);
  if (clean.length <= CHUNK_CHARS) return clean.length ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + CHUNK_CHARS);
    if (end < clean.length) {
      // try to break at paragraph, then sentence, then space
      const slice = clean.slice(start, end);
      const paraBreak = slice.lastIndexOf("\n\n");
      const sentBreak = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("।"),
        slice.lastIndexOf("\n"),
      );
      const spaceBreak = slice.lastIndexOf(" ");
      const cut =
        paraBreak > CHUNK_CHARS * 0.5
          ? paraBreak + 2
          : sentBreak > CHUNK_CHARS * 0.5
            ? sentBreak + 1
            : spaceBreak > CHUNK_CHARS * 0.5
              ? spaceBreak + 1
              : slice.length;
      end = start + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks;
}

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB cap for edge runtime limits
const MAX_PDF_PAGES = 400;

async function extractPdf(buf: ArrayBuffer): Promise<string> {
  if (buf.byteLength > MAX_PDF_BYTES) {
    throw new Error(
      `TOOLARGE:PDF ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB חורג מהמגבלה של ${MAX_PDF_BYTES / 1024 / 1024}MB`,
    );
  }
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf), {
      disableFontFace: true,
      useSystemFonts: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`UNSUPPORTED:pdf-malformed (${msg.slice(0, 120)})`);
  }
  const total = Math.min(pdf.numPages ?? 0, MAX_PDF_PAGES);
  const parts: string[] = [];
  try {
    for (let i = 1; i <= total; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const line = (content.items as Array<{ str?: string }>)
        .map((it) => it.str ?? "")
        .join(" ");
      if (line.trim()) parts.push(line);
      // @ts-expect-error cleanup is provided by pdfjs page proxies
      page.cleanup?.();
      if (i % PAGE_YIELD_EVERY === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`UNSUPPORTED:pdf-malformed (${msg.slice(0, 120)})`);
  } finally {
    // @ts-expect-error destroy is provided by pdfjs document proxy
    await pdf.destroy?.();
  }
  return parts.join("\n\n");
}

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function loadZip(buf: ArrayBuffer, ext: string): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(buf);
  } catch {
    throw new Error(`UNSUPPORTED:${ext}-malformed`);
  }
}

async function extractDocx(buf: ArrayBuffer): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error("UNSUPPORTED:doc-legacy");
  }
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("UNSUPPORTED:docx-malformed");
  const xml = await doc.async("string");
  const paras = xml.split(/<\/w:p>/i);
  const out: string[] = [];
  for (const p of paras) {
    const texts = [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi)].map((m) =>
      unescapeXml(m[1]),
    );
    const line = texts.join("");
    if (line.trim()) out.push(line);
  }
  return out.join("\n");
}

async function extractPptx(buf: ArrayBuffer): Promise<string> {
  const zip = await loadZip(buf, "pptx");
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      return na - nb;
    });
  const out: string[] = [];
  for (const name of slides) {
    const xml = await zip.file(name)!.async("string");
    const parts: string[] = [];
    for (const m of xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)) {
      const s = unescapeXml(m[1]);
      if (s.trim()) parts.push(s);
    }
    if (parts.length) out.push(parts.join(" "));
  }
  return out.join("\n\n");
}

async function extractXlsx(buf: ArrayBuffer): Promise<string> {
  const zip = await loadZip(buf, "xlsx");
  // Shared strings
  const shared: string[] = [];
  const ssFile = zip.file("xl/sharedStrings.xml");
  if (ssFile) {
    const xml = await ssFile.async("string");
    for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
      const runs = [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)].map((m) =>
        unescapeXml(m[1]),
      );
      shared.push(runs.join(""));
    }
  }
  const sheets = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/sheet(\d+)\.xml$/i)?.[1] ?? 0);
      const nb = Number(b.match(/sheet(\d+)\.xml$/i)?.[1] ?? 0);
      return na - nb;
    });
  const out: string[] = [];
  for (const name of sheets) {
    const xml = await zip.file(name)!.async("string");
    const rows: string[] = [];
    for (const rowM of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      const cells: string[] = [];
      for (const cM of rowM[1].matchAll(
        /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi,
      )) {
        const attrs = (cM[1] ?? cM[3] ?? "");
        const inner = cM[2] ?? "";
        const tAttr = attrs.match(/\bt="([^"]+)"/)?.[1];
        let val = "";
        if (tAttr === "s") {
          const idx = Number(inner.match(/<v[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? "-1");
          if (Number.isFinite(idx) && idx >= 0 && idx < shared.length) val = shared[idx];
        } else if (tAttr === "inlineStr") {
          const runs = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)].map((m) =>
            unescapeXml(m[1]),
          );
          val = runs.join("");
        } else {
          const v = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/i)?.[1];
          if (v) val = unescapeXml(v);
          else {
            const runs = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)].map((m) =>
              unescapeXml(m[1]),
            );
            val = runs.join("");
          }
        }
        cells.push(val);
      }
      const line = cells.join("\t").replace(/\t+$/, "");
      if (line.trim()) rows.push(line);
    }
    if (rows.length) out.push(rows.join("\n"));
  }
  return out.join("\n\n");
}

async function extractByType(
  fileType: string,
  buf: ArrayBuffer,
): Promise<string> {
  const t = fileType.toLowerCase();
  if (t === "pdf") return extractPdf(buf);
  if (t === "docx" || t === "dotx") return extractDocx(buf);
  if (t === "pptx") return extractPptx(buf);
  if (t === "xlsx") return extractXlsx(buf);
  if (t === "ppt") throw new Error("LEGACY:ppt");
  if (t === "doc") throw new Error("LEGACY:doc");
  if (SUPPORTED_TEXT.has(t)) return new TextDecoder("utf-8").decode(buf);
  throw new Error(`UNSUPPORTED:${t}`);
}

async function embedBatch(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
  const MAX_ATTEMPTS = 6;
  let attempt = 0;
  while (true) {
    attempt++;
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      signal,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: inputs,
        input_type: "document",
      }),
    });
    if (res.ok) {
      const payload = await res.json();
      const arr = (payload.data ?? []) as { embedding: number[]; index: number }[];
      arr.sort((a, b) => a.index - b.index);
      return arr.map((d) => d.embedding);
    }
    const body = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      let friendly = body.slice(0, 400);
      try {
        const parsed = JSON.parse(body);
        if (parsed.error?.message) friendly = parsed.error.message;
        else if (parsed.detail) friendly = parsed.detail;
      } catch { /* keep raw */ }
      throw new Error(`Embeddings failed (${res.status}): ${friendly}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30000, 2000 * 2 ** (attempt - 1));
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Auth: caller must be admin
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);

  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes, error: userErr } = await asUser.auth.getUser(token);
  if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
  const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", {
    _user_id: userRes.user.id,
    _role: "admin",
  });
  if (roleErr) return json({ error: roleErr.message }, 500);
  if (!isAdmin) return json({ error: "Forbidden" }, 403);

  let body: { document_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const documentId = body.document_id;
  if (!documentId) return json({ error: "document_id required" }, 400);

  const { data: doc, error: docErr } = await admin
    .from("documents")
    .select("id, category, file_path, file_type, title")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr) return json({ error: docErr.message }, 500);
  if (!doc) return json({ error: "Document not found" }, 404);

  await admin
    .from("documents")
    .update({ processing_status: "processing", processing_error: null })
    .eq("id", documentId);

  const PROCESSING_TIMEOUT_MS = 3 * 60 * 1000;
  const TIMEOUT_MSG = "קובץ גדול מדי לעיבוד אוטומטי — נדרש טיפול ידני";
  const abortController = new AbortController();
  let timedOut = false;

  const runJob = async () => {
    try {
      const { data: fileData, error: dlErr } = await admin.storage
        .from(doc.category)
        .download(doc.file_path);
      if (dlErr) throw new Error(`Download failed: ${dlErr.message}`);
      const buf = await fileData.arrayBuffer();

      let text: string;
      try {
        text = await extractByType(doc.file_type, buf);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("UNSUPPORTED:")) {
          const ext = msg.split(":")[1] ?? doc.file_type;
          await admin
            .from("documents")
            .update({
              processing_status: "unsupported",
              processing_error: `סוג קובץ לא נתמך לחילוץ טקסט: ${ext}`,
              processed: false,
            })
            .eq("id", documentId);
          return;
        }
        if (msg.startsWith("TOOLARGE:")) {
          await admin
            .from("documents")
            .update({
              processing_status: "unsupported",
              processing_error: msg.slice("TOOLARGE:".length),
              processed: false,
            })
            .eq("id", documentId);
          return;
        }
        if (msg.startsWith("LEGACY:")) {
          const kind = msg.slice("LEGACY:".length);
          const legacyMsg =
            kind === "ppt"
              ? "פורמט PowerPoint ישן (.ppt) — נדרשת המרה ל-.pptx"
              : kind === "doc"
                ? "פורמט Word ישן (.doc) — נדרשת המרה ל-.docx"
                : `פורמט ישן: ${kind}`;
          await admin
            .from("documents")
            .update({
              processing_status: "unsupported",
              processing_error: legacyMsg,
              processed: false,
            })
            .eq("id", documentId);
          return;
        }
        throw e;
      }

      const chunks = chunkText(sanitizeText(text));
      if (chunks.length === 0) {
        const isPdf = doc.file_type.toLowerCase() === "pdf";
        await admin
          .from("documents")
          .update({
            processing_status: isPdf ? "unsupported" : "error",
            processing_error: isPdf
              ? "PDF סרוק — נדרש OCR"
              : "לא נמצא טקסט במסמך",
            processed: false,
          })
          .eq("id", documentId);
        return;
      }


      await admin.from("document_chunks").delete().eq("document_id", documentId);

      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch = chunks.slice(i, i + EMBED_BATCH);
        const vectors = await embedBatch(batch, abortController.signal);
        const rows = batch.map((chunk_text, k) => ({
          document_id: documentId,
          chunk_index: i + k,
          chunk_text,
          embedding: vectors[k] as unknown as string,
        }));
        for (let j = 0; j < rows.length; j += INSERT_BATCH_SIZE) {
          const slice = rows.slice(j, j + INSERT_BATCH_SIZE);
          const { error: insErr } = await admin.from("document_chunks").insert(slice);
          if (insErr) throw new Error(`Insert chunks failed: ${insErr.message}`);
        }
        if (i + EMBED_BATCH < chunks.length) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      await admin
        .from("documents")
        .update({
          processing_status: "processed",
          processed: true,
          processed_at: new Date().toISOString(),
          processing_error: null,
        })
        .eq("id", documentId);
    } catch (e) {
      if (timedOut) return;
      const msg = truncateErr(e instanceof Error ? e.message : String(e));
      await admin
        .from("documents")
        .update({
          processing_status: "error",
          processing_error: msg,
          processed: false,
        })
        .eq("id", documentId);
    }
  };

  const runWithTimeout = async () => {
    let timer: number | undefined;
    const timeoutPromise = new Promise<void>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        abortController.abort();
        reject(new Error("__TIMEOUT__"));
      }, PROCESSING_TIMEOUT_MS) as unknown as number;
    });
    try {
      await Promise.race([runJob(), timeoutPromise]);
    } catch (e) {
      if (timedOut) {
        await admin
          .from("documents")
          .update({
            processing_status: "error",
            processing_error: TIMEOUT_MSG,
            processed: false,
          })
          .eq("id", documentId);
      } else {
        const msg = truncateErr(e instanceof Error ? e.message : String(e));
        await admin
          .from("documents")
          .update({
            processing_status: "error",
            processing_error: msg,
            processed: false,
          })
          .eq("id", documentId);
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  // @ts-expect-error EdgeRuntime is provided by Supabase edge runtime
  EdgeRuntime.waitUntil(runWithTimeout());
  return json({ ok: true, status: "processing" }, 202);
});
