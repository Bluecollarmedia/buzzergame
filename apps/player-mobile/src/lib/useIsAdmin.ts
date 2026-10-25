import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { getApi } from "./supabase";

/** True when the signed-in account is a platform admin (decided by the database, not the app). */
export function useIsAdmin(): boolean {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    if (!user) {
      setIsAdmin(false);
      return;
    }
    getApi()
      .myEntitlement()
      .then((e) => live && setIsAdmin(!!e.isAdmin))
      .catch(() => live && setIsAdmin(false));
    return () => {
      live = false;
    };
  }, [user]);
  return isAdmin;
}
