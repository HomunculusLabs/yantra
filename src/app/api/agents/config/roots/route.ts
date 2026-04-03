import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import {
  getCabinetRoots,
  getCabinetRootsConfigPath,
  readCabinetRootsConfig,
  saveCabinetRootsConfig,
} from "@/lib/config/cabinet-roots";

function buildPayload() {
  const config = readCabinetRootsConfig();
  const effective = getCabinetRoots();
  const configuredVaultRoot = config.vaultRoot || effective.vaultRoot;
  const configuredRuntimeRoot = config.runtimeRoot || effective.runtimeRoot;

  return {
    vaultRoot: configuredVaultRoot,
    runtimeRoot: configuredRuntimeRoot,
    effectiveRoots: {
      vaultRoot: effective.vaultRoot,
      runtimeRoot: effective.runtimeRoot,
    },
    configPath: getCabinetRootsConfigPath(),
    checks: {
      vaultExists: fs.existsSync(configuredVaultRoot),
      runtimeExists: fs.existsSync(configuredRuntimeRoot),
    },
    restartRequired: true,
  };
}

export async function GET() {
  try {
    return NextResponse.json(buildPayload());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read roots config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      vaultRoot?: string;
      runtimeRoot?: string;
    };

    await saveCabinetRootsConfig({
      vaultRoot: body.vaultRoot,
      runtimeRoot: body.runtimeRoot,
    });

    return NextResponse.json(buildPayload());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save roots config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
