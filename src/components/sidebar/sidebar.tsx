"use client";

import { useEffect, useMemo, useState } from "react";
import { PanelLeftClose, PanelLeft, Settings, EyeOff, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TreeView } from "./tree-view";
import { NewPageDialog } from "./new-page-dialog";
import { useAppStore } from "@/stores/app-store";
import { useTreeStore } from "@/stores/tree-store";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  const mounted = typeof window !== "undefined";

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return { isMobile, mounted };
}

export function Sidebar() {
  const { isMobile, mounted } = useIsMobile();
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const setCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const section = useAppStore((s) => s.section);
  const setSection = useAppStore((s) => s.setSection);
  const nodeByPath = useTreeStore((s) => s.nodeByPath);
  const hiddenFolderPaths = useTreeStore((s) => s.hiddenFolderPaths);
  const unhideFolder = useTreeStore((s) => s.unhideFolder);
  const clearHiddenFolders = useTreeStore((s) => s.clearHiddenFolders);

  const hiddenFolderItems = useMemo(
    () =>
      [...hiddenFolderPaths].map((path) => ({
        path,
        title: nodeByPath[path]?.frontmatter?.title || nodeByPath[path]?.name || path.split("/").pop() || path,
      })),
    [hiddenFolderPaths, nodeByPath]
  );

  useEffect(() => {
    if (mounted && isMobile) setCollapsed(true);
  }, [mounted, isMobile, setCollapsed]);

  const desktopClass = collapsed ? "w-0 overflow-hidden" : "w-[280px] min-w-[280px]";
  const mobileClass = cn(
    "fixed left-0 top-0 bottom-0 z-40",
    collapsed ? "w-0 overflow-hidden" : "w-[280px]"
  );

  return (
    <>
      {mounted && isMobile && !collapsed && (
        <div
          className="fixed inset-0 bg-black/50 z-30"
          onClick={() => setCollapsed(true)}
        />
      )}

      <aside
        suppressHydrationWarning
        className={cn(
          "flex flex-col border-r border-border bg-sidebar transition-all duration-200 h-screen overflow-hidden",
          mounted && isMobile ? mobileClass : desktopClass
        )}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-light.png" alt="Yantra" className="h-6 w-6 rounded" />
            <span className="text-[13px] font-semibold tracking-[-0.02em]">
              Yantra
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setCollapsed(true)}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
        <Separator />

        <div className="px-3 pt-2 flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Knowledge Base
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                "hover:bg-accent hover:text-accent-foreground"
              )}
              title="Hidden folders"
            >
              {hiddenFolderItems.length > 0 ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Hidden folders</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {hiddenFolderItems.length === 0 ? (
                <DropdownMenuItem disabled>No hidden folders</DropdownMenuItem>
              ) : (
                hiddenFolderItems.map((item) => (
                  <DropdownMenuItem key={item.path} onClick={() => unhideFolder(item.path)}>
                    <Eye className="h-4 w-4 mr-2" />
                    <span className="truncate">{item.title}</span>
                  </DropdownMenuItem>
                ))
              )}
              {hiddenFolderItems.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={clearHiddenFolders}>
                    <Eye className="h-4 w-4 mr-2" />
                    Unhide All
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <TreeView />

        <div className="p-2 flex items-center gap-1">
          <div className="flex-1">
            <NewPageDialog />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 shrink-0",
              section.type === "settings" && "bg-accent text-foreground"
            )}
            onClick={() => setSection({ type: "settings" })}
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </aside>
      {collapsed && (
        <Button
          variant="outline"
          size="icon-sm"
          className={cn(
            "absolute top-3 z-10 shadow-sm bg-background/90 backdrop-blur-sm",
            isMobile ? "left-3 z-50" : "left-2"
          )}
          onClick={() => setCollapsed(false)}
          title="Open sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}
    </>
  );
}
