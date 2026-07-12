import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/projects")({
  head: () => ({ meta: [{ title: "ניהול פרויקטים | י. אשל בטיחות" }] }),
  component: () => <ComingSoon title="ניהול פרויקטים" description="ניהול פרויקטי בטיחות פעילים." />,
});
