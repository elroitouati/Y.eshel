import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-medium text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-soft">
            <Sparkles className="h-5 w-5 text-warning" />
          </div>
          <div>
            <p className="text-lg font-medium text-foreground">בקרוב</p>
            <p className="mt-1 text-sm text-muted-foreground">
              המודול נמצא בפיתוח ויתווסף בשלב הבא.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
