import { NextResponse } from "next/server";
import { dispatchPluginBridgeRequest } from "@/lib/plugins/plugin-bridge";

type RouteParams = {
  params: Promise<{
    entryKey: string;
    viewId: string;
  }>;
};

function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    { error: "Method not allowed." },
    {
      status: 405,
      headers: {
        Allow: "POST",
      },
    }
  );
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    if (request.headers.get("x-yantra-plugin-bridge") !== "1") {
      return badRequest("Missing X-Yantra-Plugin-Bridge header.");
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return badRequest("Plugin bridge requests must use application/json.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Plugin bridge request body must be valid JSON.");
    }

    const { entryKey: entryToken, viewId } = await params;
    const response = await dispatchPluginBridgeRequest({
      entryToken,
      viewId,
      request: body,
    });

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Plugin bridge request failed.",
      },
      { status: 500 }
    );
  }
}
