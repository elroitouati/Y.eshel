// Edge function: review-plan
// Fire safety plan review: extracts text from an uploaded plan PDF, searches
// the knowledge base for relevant standards (Voyage embedding → vector search
// in document_chunks), then sends the PDF (as a native vision document block)
// plus the retrieved standards to Claude for a structured Hebrew review.
//
// Self-contained by design (mirrors the ask-assistant / process-document
// convention of not importing across edge functions).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getDocumentProxy } from "https://esm.sh/unpdf@0.11.0";

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
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL_PRIMARY = "claude-opus-4-8";
const MODEL_FALLBACK = "claude-sonnet-5";
const MAX_PDF_BYTES = 15 * 1024 * 1024; // ~15MB (~20MB as base64)
const MAX_PDF_PAGES = 100;
const MAX_NOTE_CHARS = 2000;
const MATCH_COUNT = 8;
const MAX_CONTEXT_CHARS = 15000;
const MAX_QUERY_CHARS = 6000;
const REVIEW_MAX_TOKENS = 7000;

const CATEGORY_LABELS: Record<string, string> = {
  commissioner_directives: "הוראות נציב",
  private_pool_safety: "בטיחות בריכה פרטית",
  objections: "התנגדויות",
  server_room_guidelines: "הנחיות חדר שרתים",
  organization_plan_materials: "חומרי תוכנית ארגון",
  financing_calculation: "חישוב מימון",
  educational_institutions: "מוסדות חינוך",
  inspection_institute_forms: "טפסי מכון בקרה",
  fire_risk_survey_procedure: "נוהל סקר סיכוני אש",
  building_structure_classification: "סיווג מבנים",
  fire_extinguishing_publications: "פרסומי כיבוי אש",
  fire_risk_survey_course: "קורס סקר סיכוני אש",
  standards_institute_courses: "קורסי מכון התקנים",
  planning_building_regulations: "תקנות תכנון ובנייה",
  israeli_standards: "תקנים ישראליים",
  nfpa_standards: "תקני NFPA",
  sol_safety: "בטיחות SOL",
};

const SYSTEM_PROMPT = `אתה בודק תוכניות בטיחות אש בכיר עבור חברת "י. אשל בטיחות".

תקבל שני סוגי קלט:
1. קובץ PDF של תוכנית בטיחות אש למבנה — הכולל שרטוטים אדריכליים (תשריטי קומות, דרכי מילוט, מיקום ציוד כיבוי וגילוי) וכן מפרטים כתובים. בחן את השרטוטים חזותית לעומק: מיקום דלתות ויציאות חירום, דרכי מילוט ורוחבן, מיקום מטפי כיבוי וגלגלוני כיבוי, מערכות גילוי אש ועשן, מערכות מתזים, הפרדות אש בין אזורים, שילוט בטיחות, וסיווג/ייעוד חללים — לצד המפרט הכתוב.
2. קטעים רלוונטיים ממאגר הידע של החברה (תקנים ישראליים, תקני NFPA, הוראות נציב כבאות ואחרים).

כללים חשובים:
1. בסס כל קביעה נורמטיבית על המקורות שסופקו לך; ציין את שם התקן/המסמך הספציפי inline (למשל: "לפי ת"י 1220 חלק 3...", "על פי הוראת נציב כבאות מספר..."). אם תקן רלוונטי חסר במקורות שסופקו — ציין זאת בפירוש במקום להמציא אסמכתא.
2. פלט התשובה חייב לכלול **בדיוק** את חמשת הכותרות הבאות, בסדר הזה, כל אחת ככותרת Markdown ברמה 2 (##):
## תקציר כללי
## נקודות חיוביות
## בעיות ותקלות
## המלצות לתיקון
## סיכום ומסקנה
3. תקציר כללי: 2-3 משפטים על מהות התוכנית ותכליתה.
4. נקודות חיוביות: מה תקין ותואם תקנים בתוכנית — עם ציון התקן הרלוונטי לכל נקודה.
5. בעיות ותקלות: חריגות, ליקויים, רכיבים חסרים או לא תואמי תקן — עם ציון התקן שהופר ומיקום הליקוי בתוכנית (מספר גיליון/עמוד/אזור אם ניתן לזהות).
6. המלצות לתיקון: המלצה קונקרטית וישימה לכל בעיה שצוינה בסעיף הקודם.
7. סיכום ומסקנה: הערכה כוללת (למשל: "התוכנית עומדת ברוב הדרישות אך דורשת תיקונים ב-X ו-Y").
8. מספר את הפריטים בסעיפים "בעיות ותקלות" ו-"המלצות לתיקון".
9. אם איכות/רזולוציית השרטוטים נמוכה או שפרט מסוים אינו קריא — ציין זאת במפורש בסקירה וסמן ממצאים מושפעים כבלתי ניתנים לאימות מלא ("לא ניתן לאמת חזותית").
10. היה ספציפי — הימנע מהצהרות כלליות; כל טענה תיתמך בפרט קונקרטי מהתוכנית ובאסמכתא תקנית.
11. כתוב בעברית מקצועית וברורה.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitizeText(t: string): string {
  return t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
}

function normalizeWhitespace(t: string) {
  return t
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const PAGE_YIELD_EVERY = 20;

async function extractPdfText(buf: ArrayBuffer): Promise<string> {
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
  const numPages = pdf.numPages ?? 0;
  if (numPages > MAX_PDF_PAGES) {
    try {
      // @ts-expect-error destroy is provided by pdfjs document proxy
      await pdf.destroy?.();
    } catch {
      // ignore cleanup errors — we're already failing this request
    }
    throw new Error(`TOOMANYPAGES:${numPages}`);
  }
  const parts: string[] = [];
  try {
    for (let i = 1; i <= numPages; i++) {
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

async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "voyage-3",
      input: [text],
      input_type: "query",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Voyage embed failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const payload = await res.json();
  const vec = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error("Voyage returned no embedding");
  return vec;
}

type Chunk = {
  chunk_id: string;
  document_id: string;
  content: string;
  similarity: number;
  title: string;
  category: string;
  file_type: string;
};

function buildContext(chunks: Chunk[]): { text: string; used: Chunk[] } {
  const parts: string[] = [];
  const used: Chunk[] = [];
  let total = 0;
  for (const c of chunks) {
    const label = CATEGORY_LABELS[c.category] ?? c.category;
    const block = `[מקור: ${c.title} — ${label}]\n${c.content}\n---\n`;
    if (total + block.length > MAX_CONTEXT_CHARS && used.length > 0) break;
    parts.push(block);
    used.push(c);
    total += block.length;
  }
  return { text: parts.join("\n"), used };
}

async function callClaudeWithPdf(
  model: string,
  pdfBase64: string,
  userText: string,
): Promise<{ text: string; truncated: boolean }> {
  const body = JSON.stringify({
    model,
    max_tokens: REVIEW_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  });

  const maxAttempts = 4;
  let lastErr = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body,
    });
    if (res.ok) {
      const payload = await res.json();
      const blocks = (payload?.content ?? []) as Array<{ type?: string; text?: string }>;
      // IMPORTANT: filter by block type, not content[0] — claude-sonnet-5 (and
      // claude-opus-4-8 with thinking:"adaptive") can emit a "thinking" block
      // before the "text" block.
      const text = blocks
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n")
        .trim();
      if (!text) throw new Error("Anthropic returned no text");
      return { text, truncated: payload?.stop_reason === "max_tokens" };
    }
    const errBody = await res.text().catch(() => "");
    lastErr = `Anthropic failed (${res.status}): ${errBody.slice(0, 400)}`;
    if (![429, 500, 502, 503, 504, 529].includes(res.status)) break;
    if (attempt === maxAttempts - 1) break;
    const delay = Math.min(8000, 500 * Math.pow(2, attempt)) + Math.random() * 300;
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(lastErr || "Anthropic failed");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // --- Auth: any authenticated user (no admin check) ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "אין הרשאה — יש להתחבר מחדש" }, 401);

    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userRes, error: userErr } = await asUser.auth.getUser(token);
    if (userErr || !userRes.user) {
      return json({ error: "אין הרשאה — יש להתחבר מחדש" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // --- Parse + validate body ---
    const body = await req.json().catch(() => null);
    const pdfBase64 = typeof body?.pdf_base64 === "string" ? body.pdf_base64 : "";
    const contextNote =
      typeof body?.context_note === "string" ? body.context_note.trim() : "";

    if (!pdfBase64) return json({ error: "לא התקבל קובץ PDF" }, 400);
    if (contextNote.length > MAX_NOTE_CHARS) {
      return json({ error: "הערת ההקשר ארוכה מדי (עד 2000 תווים)" }, 400);
    }

    // Anthropic requires the base64 document data to contain no whitespace —
    // strip it once here and reuse this cleaned string everywhere downstream
    // (validation below AND the Claude request).
    const cleanedBase64 = pdfBase64.replace(/\s/g, "");
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(cleanedBase64), (c) => c.charCodeAt(0));
    } catch {
      return json({ error: "קובץ ה-PDF אינו תקין (קידוד שגוי)" }, 400);
    }

    if (bytes.byteLength > MAX_PDF_BYTES) {
      return json({ error: "הקובץ גדול מדי — המגבלה היא 15MB" }, 413);
    }

    const magic = new TextDecoder().decode(bytes.slice(0, 5));
    if (magic !== "%PDF-") {
      return json({ error: "הקובץ אינו קובץ PDF תקין" }, 400);
    }

    // --- Extract text (empty text is OK — scanned plan, vision still works) ---
    let extractedText = "";
    let warning: string | undefined;
    try {
      extractedText = await extractPdfText(bytes.buffer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("TOOMANYPAGES:")) {
        return json(
          { error: "התוכנית מכילה יותר מ-100 עמודים — יש לפצל את הקובץ" },
          400,
        );
      }
      if (msg.startsWith("UNSUPPORTED:")) {
        return json({ error: "קובץ ה-PDF פגום או לא נתמך" }, 400);
      }
      throw e;
    }

    const cleanedText = sanitizeText(normalizeWhitespace(extractedText));
    if (!cleanedText) {
      warning =
        "לא זוהה טקסט בקובץ — ככל הנראה סריקה; הניתוח מבוסס על בחינה חזותית של השרטוטים בלבד";
    }

    // --- Build KB query and search ---
    const querySample = cleanedText.slice(0, MAX_QUERY_CHARS);
    const queryParts = [querySample, contextNote].filter(Boolean);
    const kbQuery =
      queryParts.join("\n") ||
      "בדיקת תוכנית בטיחות אש למבנה: דרכי מילוט, מערכות מתזים, גילוי אש ועשן, הפרדות אש, ציוד כיבוי, שילוט";

    let context = "";
    let usedChunks: Chunk[] = [];
    try {
      const queryEmbedding = await embedQuery(kbQuery);
      const { data: chunks, error: rpcErr } = await admin.rpc("match_document_chunks", {
        query_embedding: queryEmbedding as unknown as string,
        match_count: MATCH_COUNT,
      });
      if (rpcErr) throw new Error(`match rpc failed: ${rpcErr.message}`);
      const chunkList = (chunks ?? []) as Chunk[];
      const built = buildContext(chunkList);
      context = built.text;
      usedChunks = built.used;
    } catch (e) {
      // Degrade gracefully — the PDF itself is the primary input; a KB
      // failure shouldn't fail the whole review.
      console.warn(
        "[review-plan] KB search failed, continuing without sources:",
        e instanceof Error ? e.message : String(e),
      );
    }

    const noSourcesNote =
      usedChunks.length === 0
        ? "לא נמצאו מקורות רלוונטיים במאגר הידע עבור תוכנית זו — ציין בסקירה שהיא נערכה ללא הצלבה מול מאגר התקנים, והתבסס על ידע כללי בלבד תוך ציון זאת במפורש.\n\n"
        : "";

    const userText =
      `מקורות רלוונטיים ממאגר הידע:\n\n${context || "(אין)"}\n\n${noSourcesNote}` +
      (contextNote ? `הערות והקשר מהמשתמש:\n${contextNote}\n\n` : "") +
      `בדוק את תוכנית הבטיחות המצורפת (PDF) — הן השרטוטים והן המפרט הכתוב — מול המקורות שסופקו לעיל, והחזר סקירה מקצועית בחמשת הסעיפים המדויקים שהוגדרו בהנחיות המערכת, בסדר הזה.`;

    // --- Call Claude, with fallback on overload/rate-limit ---
    let modelUsed = MODEL_PRIMARY;
    let result: { text: string; truncated: boolean };
    try {
      result = await callClaudeWithPdf(MODEL_PRIMARY, cleanedBase64, userText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/\(429|529|503\)/.test(msg)) {
        console.warn("[review-plan] primary model overloaded, falling back");
        modelUsed = MODEL_FALLBACK;
        result = await callClaudeWithPdf(MODEL_FALLBACK, cleanedBase64, userText);
      } else {
        throw err;
      }
    }

    // --- Dedup sources by document_id ---
    const seen = new Set<string>();
    const sources: { title: string; category: string }[] = [];
    for (const c of usedChunks) {
      if (seen.has(c.document_id)) continue;
      seen.add(c.document_id);
      sources.push({
        title: c.title,
        category: CATEGORY_LABELS[c.category] ?? c.category,
      });
    }

    if (result.truncated) {
      const truncNote = "הסקירה נקטעה עקב אורך — ייתכן שחסר סיום";
      warning = warning ? `${warning}; ${truncNote}` : truncNote;
    }

    return json({
      review: result.text,
      sources,
      model_used: modelUsed,
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[review-plan] error:", msg);
    return json({ error: "אירעה שגיאה בניתוח התוכנית — נסה שוב" }, 500);
  }
});
