import { Link, useRouterState } from "@tanstack/react-router";
import {
  Flame,
  LayoutDashboard,
  FolderKanban,
  FileText,
  FileSearch,
  HardHat,
  Sparkles,
  Users,
  BookOpen,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAccess } from "@/lib/access-context";

const baseNavItems = [
  { title: "דשבורד", url: "/dashboard", icon: LayoutDashboard, adminOnly: false },
  { title: "ניהול פרויקטים", url: "/projects", icon: FolderKanban, adminOnly: false },
  { title: "הצעות מחיר", url: "/quotes", icon: FileText, adminOnly: false },
  { title: "בטיחות בעבודה", url: "/safety", icon: HardHat, adminOnly: false },
  { title: "עוזר חכם", url: "/assistant", icon: Sparkles, adminOnly: false },
  { title: "בדיקת תוכנית", url: "/plan-review", icon: FileSearch, adminOnly: false },
  { title: "מאגר ידע", url: "/knowledge", icon: BookOpen, adminOnly: true },
  { title: "ניהול עובדים והרשאות", url: "/users", icon: Users, adminOnly: true },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { isAdmin } = useAccess();
  const navItems = baseNavItems.filter((i) => !i.adminOnly || isAdmin);

  return (
    <Sidebar side="right" collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent">
            <Flame className="h-5 w-5 text-sidebar-primary" fill="currentColor" strokeWidth={1.5} />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-medium text-sidebar-foreground">י. אשל בטיחות</span>
            <span className="text-xs text-sidebar-foreground/60">מערכת ניהול</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const active = pathname === item.url || pathname.startsWith(item.url + "/");
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                      className="data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:font-medium data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"
                    >
                      <Link to={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
