import { NextRequest, NextResponse } from "next/server";

const APP_HOST = "app.snowmind.xyz";
const WWW_HOST = "www.snowmind.xyz";
const APEX_HOST = "snowmind.xyz";
const DOCS_HOST = "docs.snowmind.xyz";

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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = req.nextUrl.hostname.toLowerCase();

  if (isBypassedPath(pathname)) {
    return NextResponse.next();
  }

  if (pathname === "/docs" || pathname.startsWith("/docs/")) {
    return redirectToHost(req, DOCS_HOST);
  }

  if (host === APEX_HOST) {
    return redirectToHost(req, WWW_HOST);
  }

  if (host === WWW_HOST) {
    if (isAppRoute(pathname)) {
      return redirectToHost(req, APP_HOST);
    }
    return NextResponse.next();
  }

  if (host === APP_HOST) {
    if (!isAppRoute(pathname)) {
      return redirectToHost(req, WWW_HOST);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
