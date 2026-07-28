import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AdminContext = {
  userId: string;
  displayName: string;
};

export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const supabase = await createServerSupabaseClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || typeof userId !== "string") {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("admin_profiles")
    .select("display_name, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError || !profile?.is_active) {
    return null;
  }

  return {
    userId,
    displayName: profile.display_name,
  };
});

export async function requireAdmin(): Promise<AdminContext> {
  const admin = await getAdminContext();

  if (!admin) {
    redirect("/admin/login");
  }

  return admin;
}
