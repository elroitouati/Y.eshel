import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Send, Sparkles, FileText } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/assistant")({
  head: () => ({ meta: [{ title: "עוזר חכם | י. אשל בטיחות" }] }),
  component: AssistantPage,
});

type Source = { title: string; category: string };
type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};
type Mode = "fast" | "deep";

function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("fast");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  const send = async () => {
    const question = input.trim();
    if (!question || isLoading) return;

    const nextMessages: Message[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setIsLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke("ask-assistant", {
        body: { question, mode, conversation_history: history },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: data.answer as string,
          sources: (data.sources as Source[]) ?? [],
        },
      ]);
    } catch (err) {
      console.error("[assistant] error:", err);
      toast.error("לא הצלחתי להתחבר לעוזר, נסה שוב");
      setMessages(messages);
      setInput(question);
    } finally {
      setIsLoading(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div dir="rtl" className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="border-b bg-card px-6 py-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">עוזר חכם</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          שאלות מקצועיות בבטיחות אש — מבוסס על מאגר הידע של י. אשל בטיחות.
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && !isLoading && (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              שאל שאלה כלשהי בנושא בטיחות אש — לדוגמה: "מהם התקנים החלים על מערכת מתזים במחסן?"
            </div>
          )}

          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}

          {isLoading && (
            <div className="flex items-start">
              <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                מחפש במאגר הידע...
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="border-t bg-card px-4 py-4 md:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">סוג תשובה:</span>
            <div className="inline-flex rounded-md border p-1">
              <ModeButton active={mode === "fast"} onClick={() => setMode("fast")}>
                תשובה מהירה
              </ModeButton>
              <ModeButton active={mode === "deep"} onClick={() => setMode("deep")}>
                תשובה מעמיקה
              </ModeButton>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="הקלד שאלה..."
              disabled={isLoading}
              rows={2}
              className="min-h-[3rem] flex-1 resize-none"
            />
            <Button
              onClick={() => void send()}
              disabled={isLoading || !input.trim()}
              size="icon"
              className="h-12 w-12 shrink-0"
              aria-label="שלח"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-2", isUser ? "items-start" : "items-end")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-lg px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-secondary text-secondary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {message.content}
      </div>
      {!isUser && message.sources && message.sources.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap gap-1.5">
          {message.sources.map((s, i) => (
            <Badge key={i} variant="outline" className="gap-1 text-xs font-normal">
              <FileText className="h-3 w-3" />
              {s.title} · {s.category}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
