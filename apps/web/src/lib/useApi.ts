"use client";

import { useMemo } from "react";
import { createGameApi } from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";

export function useApi() {
  return useMemo(() => createGameApi(getSupabase()), []);
}
