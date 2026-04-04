"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTreeStore } from "@/stores/tree-store";

export function NewPageDialog() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const createPage = useTreeStore((s) => s.createPage);
  const openPath = useTreeStore((s) => s.openPath);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const newPath = await createPage("", title.trim());
      await openPath(newPath, { source: "mutation" });
      setTitle("");
      setOpen(false);
    } catch (error) {
      console.error("Failed to create page:", error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="flex items-center gap-2 w-full text-sm px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer">
        <Plus className="h-4 w-4" />
        New Page
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Page</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
          className="flex gap-2"
        >
          <Input
            placeholder="Page title..."
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
          <Button type="submit" disabled={!title.trim() || creating}>
            {creating ? "Creating..." : "Create"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
