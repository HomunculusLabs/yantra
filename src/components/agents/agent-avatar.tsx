import { cn } from "@/lib/utils";

const SIZE_CLASSES = {
  xs: "h-4 min-w-4 px-1 text-[9px]",
  sm: "h-5 min-w-5 px-1.5 text-[10px]",
  md: "h-7 min-w-7 px-2 text-[11px]",
  lg: "h-9 min-w-9 px-2.5 text-[13px]",
  xl: "h-10 min-w-10 px-3 text-sm",
} as const;

export function getAgentInitials(name?: string, slug?: string): string {
  const source = (name || slug || "Agent").trim();
  const words = source.split(/[\s_-]+/).filter(Boolean);

  if (words.length === 0) return "AG";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

interface AgentAvatarProps {
  name?: string;
  slug?: string;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}

export function AgentAvatar({ name, slug, size = "sm", className }: AgentAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-primary/15 bg-primary/10 font-semibold uppercase leading-none text-primary",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {getAgentInitials(name, slug)}
    </span>
  );
}
