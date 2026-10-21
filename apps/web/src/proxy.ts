import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/quizzes", "/sessions", "/account", "/admin"];
const AUTH_PAGES = ["/login", "/signup"];

/**
 * Refreshes the Supabase auth session cookie and keeps signed-out visitors
 * away from host pages. Authorization itself is enforced by the database
 * (RLS and checks inside every RPC), not here.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  if (!url || !key) {
    const res = NextResponse.next();
    res.headers.set("x-request-id", requestId);
    return res;
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const path = request.nextUrl.pathname;
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(to);
  }
  if (user && AUTH_PAGES.includes(path)) {
    const to = request.nextUrl.clone();
    to.pathname = "/dashboard";
    to.search = "";
    return NextResponse.redirect(to);
  }
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: [
    // Skip static files, images, player/projector routes (no host session needed).
    "/((?!_next/static|_next/image|favicon.ico|j/|present/|join|api/health|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
