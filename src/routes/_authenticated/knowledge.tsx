import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAccess } from "@/lib/access-context";
import {
  createDocument,
  createSignedDownloadUrl,
  createSignedUploadUrl,
  deleteDocument,
  DOCUMENT_CATEGORIES,
  listDocuments,
  type DocumentCategory,
  type KnowledgeDocument,
} from "@/lib/documents.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/knowledge")({
  head: () => ({ meta: [{ title: "מאגר ידע | י. אשל בטיחות" }] }),
  component: KnowledgePage,
});

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  commissioner_directives: "הוראות נציב",
  private_pool_safety: "הנחיות בטיחות בבריכת שחייה פרטית",
  objections: "השגות",
  server_room_guidelines: "חדר שרתים - הנחיות",
  organization_plan_materials: "חומר תוכניות התארגנות",
  financing_calculation: "חישוב מימון",
  educational_institutions: "מוסדות חינוך",
  inspection_institute_forms: "מכון בקרה ישראלי - טפסים",
  fire_risk_survey_procedure: "נוהל דוח עריכת סקר סיכוני אש",
  building_structure_classification: "סיווג שלד בניין",
  fire_extinguishing_publications: "פרסומים כיבוי אש",
  fire_risk_survey_course: "קורס ניתוח סקר סיכוני אש",
  standards_institute_courses: "קורסים מכון התקנים",
  planning_building_regulations: "תקנות תכנון ובניה",
  israeli_standards: "תקנים ישראליים",
  nfpa_standards: "תקני NFPA",
  sol_safety: "בטיחות סול",
};

function fileTypeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext || "unknown";
}

function formatSize(bytes: number | null): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTypeIcon({ type }: { type: string }) {
  const t = type.toLowerCase();
  if (["xlsx", "xls", "csv"].includes(t)) return <FileSpreadsheet className="h-4 w-4" />;
  if (["zip", "rar", "7z"].includes(t)) return <FileArchive className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

const STATUS_META: Record<
  KnowledgeDocument["processing_status"],
  { label: string; className: string }
> = {
  pending: {
    label: "ממתין לעיבוד",
    className: "border-border text-muted-foreground",
  },
  processing: {
    label: "בעיבוד",
    className: "border-amber-300 bg-amber-50 text-amber-800",
  },
  processed: {
    label: "עובד",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  unsupported: {
    label: "לא נתמך",
    className: "border-slate-300 bg-slate-100 text-slate-700",
  },
  error: {
    label: "שגיאה",
    className: "border-red-300 bg-red-50 text-red-800",
  },
};

const IMAGE_TYPES = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff"]);

function StatusBadge({
  doc,
  isProcessing,
}: {
  doc: KnowledgeDocument;
  isProcessing: boolean;
}) {
  const status =
    isProcessing && doc.processing_status !== "processed"
      ? "processing"
      : doc.processing_status;

  const err = doc.processing_error ?? "";
  const ft = doc.file_type.toLowerCase();
  const isScanned = /סרוק|OCR/i.test(err);

  let meta = STATUS_META[status] ?? STATUS_META.pending;
  let tooltip = err;

  if (isScanned) {
    meta = {
      label: "PDF סרוק",
      className: "border-slate-300 bg-slate-100 text-slate-700",
    };
    tooltip = err || "PDF סרוק — נדרש OCR";
  } else if (doc.processing_status === "unsupported") {
    if (ft === "doc") tooltip = "פורמט ישן (.doc) — המר ל-.docx";
    else if (IMAGE_TYPES.has(ft)) tooltip = "קובץ תמונה — לא ניתן לחלץ טקסט";
  }

  const showAlert =
    !isScanned &&
    (doc.processing_status === "error" || doc.processing_status === "unsupported") &&
    !!doc.processing_error;

  return (
    <div className="flex items-center gap-1">
      <span title={tooltip || undefined}>
        <Badge variant="outline" className={`gap-1 ${meta.className}`}>
          {status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
          {meta.label}
        </Badge>
      </span>
      {showAlert && (
        <span title={doc.processing_error ?? ""}>
          <AlertCircle className="h-4 w-4 text-destructive" />
        </span>
      )}
    </div>
  );
}


function KnowledgePage() {
  const access = useAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (!access.isAdmin) {
    navigate({ to: "/dashboard", replace: true });
    return null;
  }

  const [filter, setFilter] = useState<DocumentCategory | "all">("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toDelete, setToDelete] = useState<KnowledgeDocument | null>(null);

  const docsQuery = useQuery({
    queryKey: ["documents", "list"],
    queryFn: () => listDocuments(),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["documents", "list"] });

  const counts = useMemo(() => {
    const map = Object.fromEntries(
      DOCUMENT_CATEGORIES.map((c) => [c, 0]),
    ) as Record<DocumentCategory, number>;
    for (const d of docsQuery.data ?? []) {
      if (d.category in map) map[d.category]++;
    }
    return map;
  }, [docsQuery.data]);

  const filtered = useMemo(() => {
    const list = docsQuery.data ?? [];
    return filter === "all" ? list : list.filter((d) => d.category === filter);
  }, [docsQuery.data, filter]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("המסמך נמחק");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "שגיאה במחיקה"),
  });

  const handleDownload = async (doc: KnowledgeDocument) => {
    try {
      const { url } = await createSignedDownloadUrl({ data: { id: doc.id } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "שגיאה בהורדה");
    }
  };

  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  type BatchState = {
    done: number;
    total: number;
    ok: number;
    failed: number;
    unsupported: number;
  };
  const [batchState, setBatchState] = useState<BatchState | null>(null);

  const CLIENT_TIMEOUT_MS = 4 * 60 * 1000;

  // Poll documents.processing_status until it becomes terminal, or timeout.
  const waitForTerminalStatus = async (
    docId: string,
    maxMs: number,
  ): Promise<"processed" | "error" | "unsupported" | "timeout"> => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 2500));
      const { data } = await supabase
        .from("documents")
        .select("processing_status")
        .eq("id", docId)
        .maybeSingle();
      const s = data?.processing_status;
      if (s === "processed" || s === "error" || s === "unsupported") return s;
    }
    return "timeout";
  };

  const runProcess = async (docId: string, opts?: { silent?: boolean; awaitTerminal?: boolean }) => {
    const silent = opts?.silent ?? false;
    setProcessingIds((prev) => new Set(prev).add(docId));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: "ok" | "failed" | "unsupported" = "ok";
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("אין הרשאה — יש להתחבר מחדש");
      const invokePromise = supabase.functions.invoke("process-document", {
        body: { document_id: docId },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), CLIENT_TIMEOUT_MS);
      });
      const { data, error } = (await Promise.race([
        invokePromise,
        timeoutPromise,
      ])) as Awaited<typeof invokePromise>;
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (opts?.awaitTerminal) {
        const final = await waitForTerminalStatus(docId, CLIENT_TIMEOUT_MS);
        if (final === "unsupported") outcome = "unsupported";
        else if (final === "error" || final === "timeout") outcome = "failed";
        else outcome = "ok";
      }
    } catch (e) {
      outcome = "failed";
      if (!silent) toast.error(e instanceof Error ? e.message : "שגיאה בעיבוד");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
      if (!opts?.awaitTerminal) invalidate();
    }
    return outcome;
  };

  const [batchLabel, setBatchLabel] = useState<string>("מעבד");

  const runBatch = async (list: KnowledgeDocument[], label: string) => {
    if (list.length === 0) {
      toast.info("אין מסמכים לעיבוד");
      return;
    }
    setBatchLabel(label);
    setBatchState({ done: 0, total: list.length, ok: 0, failed: 0, unsupported: 0 });
    const CONCURRENCY = 3;
    let cursor = 0;
    const counters = { done: 0, ok: 0, failed: 0, unsupported: 0 };
    const worker = async () => {
      while (cursor < list.length) {
        const idx = cursor++;
        const result = await runProcess(list[idx].id, { silent: true, awaitTerminal: true });
        counters.done++;
        if (result === "ok") counters.ok++;
        else if (result === "unsupported") counters.unsupported++;
        else counters.failed++;
        setBatchState({ total: list.length, ...counters });
      }
    };
    await Promise.allSettled(Array.from({ length: CONCURRENCY }, worker));
    invalidate();
    setBatchState(null);
    toast.success(
      `הסתיים: ✓ ${counters.ok} · ✗ ${counters.failed} · ⓘ ${counters.unsupported}`,
    );
  };


  const processAll = () => {
    const list = (docsQuery.data ?? []).filter(
      (d) =>
        d.processing_status === "pending" || d.processing_status === "error",
    );
    return runBatch(list, "מעבד");
  };

  const processPending = async () => {
    if (docsQuery.isLoading || docsQuery.isFetching) {
      toast.info("הרשימה עדיין נטענת, נסה שוב בעוד רגע");
      return;
    }
    const total = docsQuery.data?.length ?? 0;
    const list = (docsQuery.data ?? []).filter(
      (d) => d.processing_status === "pending",
    );
    console.log("[processPending] pending count:", list.length, "total loaded:", total);
    if (total === 0) {
      toast.error("לא נטענו מסמכים — רענן את הדף ונסה שוב");
      return;
    }
    return runBatch(list, "מעבד ממתינים");
  };


  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-medium text-foreground">
            <BookOpen className="h-6 w-6 text-primary" />
            מאגר ידע
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            העלאה וארגון של מסמכים לשימוש עתידי במערכת ובעוזר החכם.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={processPending}
            disabled={batchState !== null}
            className="border-border text-foreground"
          >
            {batchState && batchLabel === "מעבד ממתינים" ? (
              <>
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                מעבד ממתינים {batchState.done}/{batchState.total}
              </>
            ) : (
              <>
                <RefreshCw className="ml-2 h-4 w-4" />
                עבד ממתינים
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={processAll}
            disabled={batchState !== null}
            className="border-[#E0A828]/60 text-foreground hover:bg-[#E0A828]/10"
          >
            {batchState && batchLabel === "מעבד" ? (
              <>
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                מעבד {batchState.done}/{batchState.total}
              </>

            ) : (
              <>
                <Sparkles className="ml-2 h-4 w-4" />
                עבד מסמכים
              </>
            )}
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="ml-2 h-4 w-4" />
            העלאת מסמכים
          </Button>
        </div>
      </div>

      {batchState && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-4 py-2.5 text-sm"
          style={{ borderColor: "#294550", backgroundColor: "rgba(41,69,80,0.06)", color: "#294550" }}
        >
          <span className="flex items-center gap-2 font-medium">
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#E0A828" }} />
            {batchLabel}: {batchState.done} / {batchState.total}
          </span>
          <span className="text-emerald-700">✓ {batchState.ok} הצליחו</span>
          <span className="text-red-700">✗ {batchState.failed} נכשלו</span>
          <span className="text-amber-700">ⓘ {batchState.unsupported} לא נתמכים</span>
          <span className="ms-auto text-xs opacity-70">
            {Math.round((batchState.done / Math.max(1, batchState.total)) * 100)}%
          </span>
        </div>
      )}



      {(docsQuery.data?.length ?? 0) >= 4500 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠️ מספר המסמכים ({docsQuery.data?.length}) מתקרב לתקרת השליפה (5000).
          יש להעלות את המגבלה ב-<code>listDocuments</code> כדי שמסמכים ישנים לא ייעלמו מהרשימה.
        </div>
      )}



      <Card className="border-border">
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2">
            {DOCUMENT_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(c)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors ${
                  filter === c
                    ? "border-[#E0A828] bg-[#E0A828]/10 text-foreground"
                    : "border-border bg-background hover:border-[#E0A828]/60"
                }`}
              >
                <span className="text-foreground">{CATEGORY_LABELS[c]}</span>
                <span className="rounded-full bg-[#294550] px-2 py-0.5 text-[11px] font-semibold text-[#E0A828]">
                  {counts[c]}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground">סינון קטגוריה:</Label>
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הקטגוריות</SelectItem>
            {DOCUMENT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">כותרת</TableHead>
              <TableHead className="text-right">קטגוריה</TableHead>
              <TableHead className="text-right">סוג</TableHead>
              <TableHead className="text-right">גודל</TableHead>
              <TableHead className="text-right">הועלה</TableHead>
              <TableHead className="text-right">סטטוס</TableHead>
              <TableHead className="text-right">פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docsQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  טוען...
                </TableCell>
              </TableRow>
            )}
            {docsQuery.data && filtered.length === 0 && !docsQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  אין מסמכים להצגה. לחץ על "העלאת מסמכים" כדי להתחיל.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="max-w-xs">
                  <div className="flex items-center gap-2 font-medium">
                    <FileTypeIcon type={d.file_type} />
                    <span className="truncate">{d.title}</span>
                  </div>
                  {d.description && (
                    <div className="mt-1 text-xs text-muted-foreground truncate">
                      {d.description}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{CATEGORY_LABELS[d.category]}</Badge>
                </TableCell>
                <TableCell className="uppercase text-xs text-muted-foreground">
                  {d.file_type}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatSize(d.file_size)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(d.uploaded_at).toLocaleDateString("he-IL")}
                </TableCell>
                <TableCell>
                  <StatusBadge doc={d} isProcessing={processingIds.has(d.id)} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {(d.processing_status === "pending" ||
                      d.processing_status === "error") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => runProcess(d.id)}
                        disabled={processingIds.has(d.id) || batchState !== null}
                        title="עבד מסמך"
                      >
                        {processingIds.has(d.id) ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 text-[#E0A828]" />
                        )}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => handleDownload(d)}>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setToDelete(d)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={invalidate}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת מסמך</AlertDialogTitle>
            <AlertDialogDescription>
              האם למחוק את "{toDelete?.title}"? פעולה זו אינה הפיכה.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) deleteMutation.mutate(toDelete.id);
                setToDelete(null);
              }}
            >
              מחיקה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UploadDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUploaded: () => void;
}) {
  const [category, setCategory] = useState<DocumentCategory>("commissioner_directives");
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
  const MIN_FILE_SIZE = 500;
  const isJunkName = (name: string) =>
    IGNORED_NAMES.has(name) ||
    name.startsWith("._") ||
    name.startsWith("~$") ||
    name.startsWith("$") ||
    name.endsWith("~");

  const filterAcceptable = (arr: File[]): { kept: File[]; skipped: number } => {
    const kept = arr.filter((f) => !isJunkName(f.name) && f.size >= MIN_FILE_SIZE);
    return { kept, skipped: arr.length - kept.length };
  };

  const notifySkipped = (skipped: number) => {
    if (skipped > 0) {
      toast.warning(`${skipped} קבצים לא הועלו (קבצי מערכת)`);
    }
  };

  const readAllEntries = (reader: any): Promise<any[]> =>
    new Promise((resolve, reject) => {
      const all: any[] = [];
      const read = () => {
        reader.readEntries((batch: any[]) => {
          if (!batch.length) resolve(all);
          else {
            all.push(...batch);
            read();
          }
        }, reject);
      };
      read();
    });

  const walkEntry = async (entry: any): Promise<File[]> => {
    if (!entry) return [];
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej));
      return [file];
    }
    if (entry.isDirectory) {
      const entries = await readAllEntries(entry.createReader());
      const nested = await Promise.all(entries.map(walkEntry));
      return nested.flat();
    }
    return [];
  };

  const collectFilesFromDataTransfer = async (
    dt: DataTransfer,
  ): Promise<File[]> => {
    const items = dt.items;
    if (
      items &&
      items.length &&
      typeof (items[0] as any).webkitGetAsEntry === "function"
    ) {
      const entries = Array.from(items)
        .map((it) => (it as any).webkitGetAsEntry())
        .filter(Boolean);
      const nested = await Promise.all(entries.map(walkEntry));
      return nested.flat();
    }
    return Array.from(dt.files);
  };

  const reset = () => {
    setFiles([]);
    setDescription("");
    setTagsInput("");
    setCategory("commissioner_directives");
  };

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    const { kept, skipped } = filterAcceptable(Array.from(list));
    notifySkipped(skipped);
    if (kept.length) setFiles((prev) => [...prev, ...kept]);
  };

  const addFiles = (arr: File[]) => {
    const { kept, skipped } = filterAcceptable(arr);
    notifySkipped(skipped);
    if (!kept.length) return;
    if (kept.length > 100) {
      toast.warning(`נבחרו ${kept.length} קבצים — זה עשוי לקחת זמן`);
    }
    setFiles((prev) => [...prev, ...kept]);
  };


  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (files.length === 0) {
      toast.error("בחר קבצים להעלאה");
      return;
    }
    setUploading(true);
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    let successCount = 0;
    for (const file of files) {
      try {
        const { path, token } = await createSignedUploadUrl({
          data: { category, filename: file.name },
        });
        const { error: upErr } = await supabase.storage
          .from(category)
          .uploadToSignedUrl(path, token, file, {
            contentType: file.type || undefined,
          });
        if (upErr) throw upErr;

        await createDocument({
          data: {
            title: file.name,
            category,
            file_path: path,
            file_type: fileTypeFromName(file.name),
            file_size: file.size,
            description: description || null,
            tags,
          },
        });
        successCount++;
      } catch (e) {
        toast.error(
          `שגיאה בהעלאת ${file.name}: ${e instanceof Error ? e.message : "לא ידוע"}`,
        );
      }
    }
    setUploading(false);
    if (successCount > 0) {
      toast.success(`הועלו ${successCount} מסמכים`);
      onUploaded();
      reset();
      onOpenChange(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !uploading) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>העלאת מסמכים</DialogTitle>
          <DialogDescription>
            בחר קטגוריה וגרור קבצים או לחץ לבחירה. ניתן להעלות מספר קבצים יחד.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>קטגוריה</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as DocumentCategory)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setIsDragging(false);
              setScanning(true);
              try {
                const collected = await collectFilesFromDataTransfer(
                  e.dataTransfer,
                );
                addFiles(collected);
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "שגיאה בקריאת הקבצים",
                );
              } finally {
                setScanning(false);
              }
            }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            {scanning ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : (
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
            )}
            <div className="mt-2 text-sm font-medium">
              גרור קבצים או תיקיות לכאן או לחץ לבחירה
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              PDF, DOCX, XLSX ועוד — תיקיות ייסרקו רקורסיבית
            </div>

            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <div className="rounded-lg border border-border">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  {files.length} קבצים נבחרו
                  <span className="mr-1">
                    ({formatSize(files.reduce((s, f) => s + f.size, 0))} בסך הכל)
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFiles((v) => !v)}
                  className="gap-1 text-primary hover:text-primary"
                >
                  {showFiles ? (
                    <>
                      הסתר קבצים
                      <ChevronUp className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      הצג קבצים
                      <ChevronDown className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>

              {showFiles && (
                <div className="max-h-[300px] overflow-y-auto border-t border-border px-2 pb-2">
                  <div className="space-y-1 pt-2">
                    {files.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-muted/50"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <FileTypeIcon type={fileTypeFromName(f.name)} />
                          <span className="truncate">{f.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatSize(f.size)}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(i)}
                          disabled={uploading}
                        >
                          הסר
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <Label>תיאור (אופציונלי)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="תיאור קצר של המסמכים"
              className="mt-1"
              rows={2}
            />
          </div>

          <div>
            <Label>תגיות (מופרדות בפסיק)</Label>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="למשל: מטפים, גילוי אש, 2024"
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
          >
            ביטול
          </Button>
          <Button onClick={submit} disabled={uploading || files.length === 0}>
            {uploading ? (
              <>
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                מעלה...
              </>
            ) : (
              <>
                <Upload className="ml-2 h-4 w-4" />
                העלה {files.length > 0 ? `(${files.length})` : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
