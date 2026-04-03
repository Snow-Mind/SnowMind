import { NextRequest, NextResponse } from "next/server";

const APP_HOST = "app.snowmind.xyz";
const WWW_HOST = "www.snowmind.xyz";
const APEX_HOST = "snowmind.xyz";
const DOCS_HOST = "docs.snowmind.xyz";
const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

const APP_ROUTE_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/portfolio",
  "/settings",
  "/withdraw",
];

function hasPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isAppRoute(pathname: string): boolean {
  return APP_ROUTE_PREFIXES.some((prefix) => hasPrefix(pathname, prefix));
}

function isBypassedPath(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/api/")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/icon.png") return true;
  if (pathname === "/robots.txt") return true;
  if (pathname === "/sitemap.xml") return true;

  // Static assets (images/fonts/etc.)
  const lastSegment = pathname.split("/").pop() ?? "";
  if (lastSegment.includes(".")) return true;

  return false;
}

function redirectToHost(req: NextRequest, host: string): NextResponse {
  const destination = req.nextUrl.clone();
  destination.hostname = host;
  destination.protocol = "https";
  return NextResponse.redirect(destination, 308);
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" && !DEV_HOSTS.has(host)) return false;
    return (
      host === APEX_HOST
      || host === WWW_HOST
      || host === APP_HOST
      || host === DOCS_HOST
      || DEV_HOSTS.has(host)
    );
  } catch {
    return false;
  }
}

function withCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  if (!isAllowedOrigin(origin)) return response;

  response.headers.set("Access-Control-Allow-Origin", origin as string);
  response.headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With");
  response.headers.set("Access-Control-Max-Age", "86400");
  response.headers.append("Vary", "Origin");
  return response;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = req.nextUrl.hostname.toLowerCase();
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return withCorsHeaders(new NextResponse(null, { status: 204 }), origin);
  }

  if (isBypassedPath(pathname)) {
    return withCorsHeaders(NextResponse.next(), origin);
  }

  if (pathname === "/docs" || pathname.startsWith("/docs/")) {
    return withCorsHeaders(redirectToHost(req, DOCS_HOST), origin);
  }

  if (host === APEX_HOST) {
    return withCorsHeaders(redirectToHost(req, WWW_HOST), origin);
  }

  if (host === WWW_HOST) {
    if (isAppRoute(pathname)) {
      return withCorsHeaders(redirectToHost(req, APP_HOST), origin);
    }
    return withCorsHeaders(NextResponse.next(), origin);
  }

  if (host === APP_HOST) {
    if (!isAppRoute(pathname)) {
      return withCorsHeaders(redirectToHost(req, WWW_HOST), origin);
    }
    return withCorsHeaders(NextResponse.next(), origin);
  }

  return withCorsHeaders(NextResponse.next(), origin);
}

export const config = {
  matcher: ["/:path*"],
};
