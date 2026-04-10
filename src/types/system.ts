export type UpdateState =
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "error";

export interface ReleaseManifest {
  manifestVersion: number;
  version: string;
  channel: "stable";
  releaseDate: string;
  gitTag: string;
  repositoryUrl: string;
  releaseNotesUrl: string;
  sourceTarballUrl?: string;
}

export interface UpdateStatus {
  state: UpdateState;
  checkedAt?: string;
  currentVersion?: string;
  targetVersion?: string;
  error?: string;
  message?: string;
  backupPath?: string;
}

export interface UpdateCheckResult {
  current: ReleaseManifest;
  latest: ReleaseManifest | null;
  manifestUrl: string | null;
  updateAvailable: boolean;
  canApplyUpdate: boolean;
  dataDir: string;
  runtimeDir: string;
  backupRoot: string;
  instructions: string[];
  latestReleaseNotesUrl?: string;
  updateStatus: UpdateStatus;
  desktopSupported: boolean;
}
