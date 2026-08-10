import type { NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import type { Role } from "@/lib/types";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      image?: string | null;
      role: Role;
      nickname: string;
      color: string;
      photo: string | null;
      hasIntel: boolean;
    };
  }
  interface User {
    role?: Role;
    nickname?: string;
    color?: string;
    photo?: string | null;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role: Role;
    nickname: string;
    color: string;
    userId: string;
    photo: string | null;
    hasIntel?: boolean;
  }
}

import { env } from "@/env";

if (
  process.env.NODE_ENV === "production" &&
  env.AUTH_SECRET === "dev-secret-change-in-production"
) {
  throw new Error(
    "AUTH_SECRET still has the dev placeholder value. " +
    "Generate a strong secret with: npx auth secret"
  );
}

export const authConfig: NextAuthConfig = {
  trustHost: true,
  providers: [
    ...(env.AZURE_AD_CLIENT_ID && env.AZURE_AD_CLIENT_SECRET && env.AZURE_AD_TENANT_ID
      ? [
          MicrosoftEntraID({
            clientId: env.AZURE_AD_CLIENT_ID,
            clientSecret: env.AZURE_AD_CLIENT_SECRET,
            issuer: `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/v2.0`,
            authorization: {
              params: {
                scope: "openid profile email User.Read",
              },
            },
          }),
        ]
      : []),
  ],

  callbacks: {
    async authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;

      if (pathname.startsWith("/api/auth")) return true;
      if (pathname.startsWith("/api/health")) return true;

      const isPublicPage = pathname.startsWith("/login") || pathname.startsWith("/unauthorized");
      if (isPublicPage) {
        if (isLoggedIn)
          return Response.redirect(new URL("/", request.nextUrl));
        return true;
      }

      if (!isLoggedIn) return false;

      return true;
    },
  },

  pages: {
    signIn: "/login",
    error: "/unauthorized",
  },
  session: {
    strategy: "jwt",
  },
  secret: env.AUTH_SECRET,
};
