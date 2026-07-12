import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/quotes")({
  head: () => ({ meta: [{ title: "הצעות מחיר | י. אשל בטיחות" }] }),
  component: () => <ComingSoon title="הצעות מחיר" description="הפקה וניהול של הצעות מחיר ללקוחות." />,
});
