import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  AlertTriangle,
  Copy,
  FileSearch,
  FileText,
  Loader2,
  RotateCcw,
  Upload,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/plan-review")({
  head: () => ({ meta: [{ title: "בדיקת תוכנית | י. אשל בטיחות" }] }),
  component: PlanReviewPage,
});

type Source = { title: string; category: string };
type ReviewResult = {
  review: string;
  sources: Source[];
  model_used: string;
  warning?: string;
};
type Section = { title: string; body: string };

const SECTION_TITLES = [
  "תקציר כללי",
  "נקודות חיוביות",
  "בעיות ותקלות",
  "המלצות לתיקון",
  "סיכום ומסקנה",
] as const;

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_NOTE_CHARS = 2000;
const CLIENT_TIMEOUT_MS = 5 * 60 * 1000; // vision + thinking on a drawing-heavy PDF can run minutes

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error("שגיאה בקריאת הקובץ"));
    reader.readAsDataURL(file);
  });
}

function parseSections(review: string): Section[] {
  const parts = review.split(/^##\s+/m).filter((p) => p.trim());
  const sections: Section[] = parts.map((part) => {
    const newlineIdx = part.indexOf("\n");
    const title = (newlineIdx >= 0 ? part.slice(0, newlineIdx) : part).trim();
    const body = (newlineIdx >= 0 ? part.slice(newlineIdx + 1) : "").trim();
    return { title, body };
  });

  const matched = sections.filter((s) =>
    SECTION_TITLES.some((t) => s.title.includes(t)),
  );
  if (matched.length >= 2) return sections;
  return [{ title: "סקירה", body: review.trim() }];
}

function isKnownSection(title: string): (typeof SECTION_TITLES)[number] | null {
  return SECTION_TITLES.find((t) => title.includes(t)) ?? null;
}

function PlanReviewPage() {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndSetFile = (f: File | null) => {
    if (!f) return;
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      toast.error("ניתן להעלות קובץ PDF בלבד");
      return;
    }
    if (f.size > MAX_PDF_BYTES) {
      toast.error("הקובץ גדול מדי — המגבלה היא 15MB");
      return;
    }
    setFile(f);
    setResult(null);
  };

  const analyze = async () => {
    if (!file || isAnalyzing) return;
    setIsAnalyzing(true);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("אין הרשאה — יש להתחבר מחדש");

      const pdf_base64 = await fileToBase64(file);

      const invokePromise = supabase.functions.invoke("review-plan", {
        body: {
          pdf_base64,
          filename: file.name,
          context_note: note.trim() || undefined,
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("הניתוח נמשך זמן רב מדי — נסה קובץ קטן יותר או נסה שוב")),
          CLIENT_TIMEOUT_MS,
        );
      });

      const { data, error } = (await Promise.race([
        invokePromise,
        timeoutPromise,
      ])) as Awaited<typeof invokePromise>;

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResult(data as ReviewResult);
    } catch (err) {
      console.error("[plan-review] error:", err);
      toast.error(err instanceof Error ? err.message : "שגיאה בניתוח התוכנית, נסה שוב");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      setIsAnalyzing(false);
    }
  };

  const reset = () => {
    setFile(null);
    setNote("");
    setResult(null);
  };

  const copyReview = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.review);
      toast.success("הסקירה הועתקה");
    } catch {
      toast.error("שגיאה בהעתקה");
    }
  };

  const sections = result ? parseSections(result.review) : [];

  return (
    <div dir="rtl" className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-medium text-foreground">
          <FileSearch className="h-6 w-6" style={{ color: "#E0A828" }} />
          בדיקת תוכנית בטיחות אש
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          העלה תוכנית בטיחות (PDF) לקבלת סקירה מקצועית מול מאגר התקנים.
        </p>
      </header>

      {!result && (
        <div className="max-w-2xl space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              validateAndSetFile(e.dataTransfer.files[0] ?? null);
            }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              isDragging ? "bg-primary/5" : "border-border hover:border-primary/50"
            }`}
            style={isDragging ? { borderColor: "#E0A828" } : undefined}
          >
            <UploadCloud className="h-8 w-8 text-muted-foreground" />
            <div className="mt-2 text-sm font-medium">גרור קובץ PDF לכאן או לחץ לבחירה</div>
            <div className="mt-1 text-xs text-muted-foreground">
              קובץ PDF בלבד, עד 15MB
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => validateAndSetFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {file && (
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatSize(file.size)}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setFile(null)} disabled={isAnalyzing}>
                הסר
              </Button>
            </div>
          )}

          <div>
            <Label>הערות והקשר (אופציונלי)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_CHARS))}
              placeholder='לדוגמה: מבנה משרדים בן 5 קומות, שלב היתר בנייה'
              rows={3}
              className="mt-1"
              disabled={isAnalyzing}
            />
            <div className="mt-1 text-left text-xs text-muted-foreground">
              {note.length}/{MAX_NOTE_CHARS}
            </div>
          </div>

          <Button
            onClick={() => void analyze()}
            disabled={!file || isAnalyzing}
            className="w-full"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                מנתח...
              </>
            ) : (
              <>
                <Upload className="ml-2 h-4 w-4" />
                נתח תוכנית
              </>
            )}
          </Button>

          {isAnalyzing && (
            <div
              className="rounded-lg border px-4 py-3 text-sm"
              style={{ borderColor: "#294550", backgroundColor: "rgba(41,69,80,0.06)" }}
            >
              <div className="flex items-center gap-2 font-medium" style={{ color: "#294550" }}>
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#E0A828" }} />
                מנתח את התוכנית מול התקנים...
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                הניתוח כולל בחינה חזותית של השרטוטים ועשוי להימשך עד מספר דקות.
              </p>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="max-w-3xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              {file?.name}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void copyReview()}>
                <Copy className="ml-2 h-4 w-4" />
                העתק
              </Button>
              <Button variant="outline" size="sm" onClick={reset}>
                <RotateCcw className="ml-2 h-4 w-4" />
                בדיקה חדשה
              </Button>
            </div>
          </div>

          {result.warning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{result.warning}</span>
            </div>
          )}

          <div className="space-y-3">
            {sections.map((section, i) => {
              const known = isKnownSection(section.title);
              return (
                <div
                  key={i}
                  className="rounded-xl border border-border bg-card p-4"
                  style={{ borderRight: "4px solid #E0A828" }}
                >
                  <h2 className="font-medium" style={{ color: "#294550" }}>
                    {known ?? section.title}
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {section.body}
                  </p>
                </div>
              );
            })}
          </div>

          {result.sources.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                מקורות שנבדקו
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {result.sources.map((s, i) => (
                  <Badge key={i} variant="outline" className="gap-1 text-xs font-normal">
                    <FileText className="h-3 w-3" />
                    {s.title} · {s.category}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* PDF/Word export of the review is a possible follow-up; "העתק" is the v1 share mechanism. */}
        </div>
      )}
    </div>
  );
}
