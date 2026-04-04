export type AgentStackConfig = {
  vaultRoot?: string;
  agentName?: string;
  agentKey?: string;
  modeTag?: string;
  tagline?: string;
  asciiLogo?: string[];
  role?: { label?: string; value?: string };
  mission?: { label?: string; value?: string };
  workspace?: { label?: string; value?: string };
  paths?: {
    primary?: string;
    secondary?: string;
    tertiary?: string;
  };
  contextFiles?: string[];
  skills?: string[];
  skillsets?: string[];
  workflows?: Array<{ command: string; description: string }>;
  notes?: string[];
  commands?: Array<{ name: string; description: string; prompt: string }>;
  extraExtensions?: string[];
  [key: string]: unknown;
};

export type StackCatalogEntry = {
  label: string;
  path: string;
  source: string;
};

export type StackCatalog = {
  extensions: StackCatalogEntry[];
  skills: StackCatalogEntry[];
  skillsets: StackCatalogEntry[];
};

export type AgentStackPayload = {
  stackPath: string | null;
  stack: AgentStackConfig | null;
  catalog: StackCatalog;
};
