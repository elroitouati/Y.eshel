// Edge function: ask-assistant
// RAG: embed question via Voyage → vector search in document_chunks → Claude.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL_FAST = "claude-sonnet-4-5-20250929";
const MODEL_DEEP = "claude-opus-4-1-20250805";
const MATCH_COUNT = 8;
const MAX_CONTEXT_CHARS = 15000;

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

const SYSTEM_PROMPT = `אתה עוזר מומחה לבטיחות אש עבור חברת "י. אשל בטיחות".

כללים חשובים:
1. ענה **אך ורק** על סמך המקורות שסופקו לך בהודעת המשתמש. אל תשתמש בידע חיצוני או תנחש.
2. ציין תמיד את שם המסמך שממנו נלקח המידע — inline בתוך התשובה (למשל: "לפי NFPA 13 Edition 2013, סעיף...", "על פי הוראת נציב כבאות מספר...").
3. אם המקורות שסופקו לא מכילים תשובה רלוונטית לשאלה — אמור זאת בכנות: "לא מצאתי מידע רלוונטי לשאלה זו במאגר הידע." אל תמציא תשובה.
4. ענה בעברית מקצועית, ברורה ומדויקת.
5. אם השאלה דורשת מספר סעיפים או שלבים — סדר אותם בבירור (נקודות/מספור).`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

type ChatTurn = { role: "user" | "assistant"; content: string };

async function callClaude(
  model: string,
  system: string,
  history: ChatTurn[],
  userMessage: string,
): Promise<string> {
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];
  const body = JSON.stringify({ model, max_tokens: 2000, system, messages });
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
      const text = payload?.content?.[0]?.text;
      if (typeof text !== "string") throw new Error("Anthropic returned no text");
      return text;
    }
    const errBody = await res.text().catch(() => "");
    lastErr = `Anthropic failed (${res.status}): ${errBody.slice(0, 400)}`;
    // Retry only on overload/rate-limit/transient
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
    const body = await req.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    const mode = body?.mode === "deep" ? "deep" : "fast";
    const rawHistory = Array.isArray(body?.conversation_history) ? body.conversation_history : [];
    const history: ChatTurn[] = rawHistory
      .filter(
        (m: unknown) =>
          !!m &&
          typeof m === "object" &&
          typeof (m as { content?: unknown }).content === "string" &&
          ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant"),
      )
      .map((m: { role: "user" | "assistant"; content: string }) => ({
        role: m.role,
        content: m.content,
      }))
      .slice(-10);

    if (!question) return json({ error: "השאלה ריקה" }, 400);
    if (question.length > 4000) return json({ error: "השאלה ארוכה מדי" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const queryEmbedding = await embedQuery(question);

    const { data: chunks, error: rpcErr } = await admin.rpc("match_document_chunks", {
      query_embedding: queryEmbedding as unknown as string,
      match_count: MATCH_COUNT,
    });
    if (rpcErr) throw new Error(`match rpc failed: ${rpcErr.message}`);

    const chunkList = (chunks ?? []) as Chunk[];
    if (chunkList.length === 0) {
      return json({
        answer: "לא מצאתי מידע רלוונטי לשאלה זו במאגר הידע. נסה לנסח את השאלה אחרת או ודא שהמסמכים הרלוונטיים הועלו למאגר.",
        sources: [],
        model_used: mode === "deep" ? MODEL_DEEP : MODEL_FAST,
      });
    }

    const { text: context, used } = buildContext(chunkList);
    const primaryModel = mode === "deep" ? MODEL_DEEP : MODEL_FAST;

    const userMessage = `מקורות רלוונטיים ממאגר הידע:\n\n${context}\n\nשאלה: ${question}`;
    let model = primaryModel;
    let answer: string;
    try {
      answer = await callClaude(primaryModel, SYSTEM_PROMPT, history, userMessage);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // On overload/rate-limit, fall back from Opus to Sonnet
      if (mode === "deep" && /\(429|529|503\)/.test(msg)) {
        console.warn("[ask-assistant] deep model overloaded, falling back to fast model");
        model = MODEL_FAST;
        answer = await callClaude(MODEL_FAST, SYSTEM_PROMPT, history, userMessage);
      } else {
        throw err;
      }
    }


    // Dedup sources by document_id
    const seen = new Set<string>();
    const sources: { title: string; category: string }[] = [];
    for (const c of used) {
      if (seen.has(c.document_id)) continue;
      seen.add(c.document_id);
      sources.push({
        title: c.title,
        category: CATEGORY_LABELS[c.category] ?? c.category,
      });
    }

    return json({ answer, sources, model_used: model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ask-assistant] error:", msg);
    return json({ error: msg }, 500);
  }
});
