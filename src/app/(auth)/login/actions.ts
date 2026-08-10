"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { classifyLoginError, isNextRedirectError } from "@/lib/login-errors";

export type SignInResult = { ok: true } | { ok: false; error: string };

export async function microsoftSignIn(): Promise<SignInResult> {
  try {
    await signIn("microsoft-entra-id", { redirectTo: "/" });
    return { ok: true };
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    if (error instanceof AuthError) {
      return { ok: false, error: error.type };
    }
    console.error("[login] microsoftSignIn", error);
    return { ok: false, error: classifyLoginError(error) };
  }
}
