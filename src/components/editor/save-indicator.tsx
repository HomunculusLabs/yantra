import type { SaveStatus } from "@/types";

export function SaveIndicator({
  saveStatus,
  errorLabel = "Save failed",
}: {
  saveStatus: SaveStatus;
  errorLabel?: string;
}) {
  return (
    <div className="flex items-center justify-end border-t border-border px-4 py-1 text-xs text-muted-foreground/60">
      {saveStatus === "saving" && "Saving..."}
      {saveStatus === "saved" && "Saved"}
      {saveStatus === "error" && errorLabel}
    </div>
  );
}
