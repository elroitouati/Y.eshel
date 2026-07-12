import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/safety")({
  head: () => ({ meta: [{ title: "בטיחות בעבודה | י. אשל בטיחות" }] }),
  component: () => <ComingSoon title="בטיחות בעבודה" description="תיעוד, בדיקות ותהליכי בטיחות." />,
});
