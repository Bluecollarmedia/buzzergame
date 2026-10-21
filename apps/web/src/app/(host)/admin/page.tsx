import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { AdminConsole } from "@/components/admin/AdminConsole";

export const metadata: Metadata = { title: "Admin" };

export default async function Page() {
  // The database checks admin rights again on every admin call; this only
  // hides the page from non-admins.
  const sb = await getServerSupabase();
  const { data } = await sb.rpc("my_entitlement");
  if (!(data as { isAdmin?: boolean } | null)?.isAdmin) notFound();
  return <AdminConsole />;
}
