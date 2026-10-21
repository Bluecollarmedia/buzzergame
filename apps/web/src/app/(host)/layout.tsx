import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { HostNav } from "@/components/host/HostNav";

export default async function HostLayout({ children }: { children: React.ReactNode }) {
  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");
  const [{ data: profile }, { data: isAdminRow }] = await Promise.all([
    sb.from("profiles").select("display_name, disabled").eq("id", data.user.id).maybeSingle(),
    sb.rpc("my_entitlement"),
  ]);
  const isAdmin = Boolean((isAdminRow as { isAdmin?: boolean } | null)?.isAdmin);
  return (
    <div className="flex min-h-screen flex-col">
      <HostNav displayName={profile?.display_name || data.user.email || ""} isAdmin={isAdmin} />
      {profile?.disabled && (
        <div className="bg-red-600 px-4 py-2 text-center text-sm text-white">
          This account has been disabled. You can view your data but cannot host games.
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
