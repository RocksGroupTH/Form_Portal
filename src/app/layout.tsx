import type { Metadata } from "next";
import { cookies } from "next/headers";
import localFont from "next/font/local";
import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/ThemeProvider";
import { BrandProvider } from "@/components/BrandProvider";
import { BRAND_COOKIE, isValidBrand } from "@/lib/brand";
import { Noto_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";

// Weights aligned with the Dashboard reference project so Master
// Dashboard tour cards / chart titles render at the right thickness
// instead of falling back to synthesized bold from a 400-only file.
const notoSans = Noto_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto",
  display: "swap",
});
/** Self-hosted Noto Sans Thai (src/assets/fonts) — bundled at build, included in deploy. */
const notoSansThai = localFont({
  src: [
    {
      path: "../assets/fonts/noto-sans-thai/NotoSansThai-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../assets/fonts/noto-sans-thai/NotoSansThai-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../assets/fonts/noto-sans-thai/NotoSansThai-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../assets/fonts/noto-sans-thai/NotoSansThai-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-noto-thai",
  display: "swap",
});
// Space Grotesk powers `.font-display` (chart card titles, KPI numbers).
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Form Portal — Rocks Group",
  description: "Internal request and forms portal for Rocks Group",
  // NOTE: still the Rocks Group mark. `public/brandlogo/` holds only the Rocks
  // Group and company-brand logos, and the navbar's "F" mark is a CSS gradient
  // rather than a file — there is no Form Portal image to point at yet. Until one
  // is supplied here, both apps share a tab icon and the <title> above is what
  // distinguishes them.
  icons: {
    icon: "/brandlogo/rocks.png",
    apple: "/brandlogo/rocks.png",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const rawBrand = cookieStore.get(BRAND_COOKIE)?.value;
  const initialBrand = isValidBrand(rawBrand) ? rawBrand! : null;

  return (
    <html
      lang="th"
      suppressHydrationWarning
      className={`${notoSans.variable} ${notoSansThai.variable} ${spaceGrotesk.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("form-portal-theme");if(!t){var m=document.cookie.match(/form-portal-theme=(light|dark)/);if(m)t=m[1]}if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}else{document.documentElement.setAttribute("data-theme","light")}}catch(e){document.documentElement.setAttribute("data-theme","light")}})()`,
          }}
        />
      </head>
      <body className={`${notoSansThai.className} font-sans antialiased`}>
        <SessionProvider basePath="/api/auth">
          <ThemeProvider>
            <BrandProvider initialBrand={initialBrand}>
              {children}
              <Toaster richColors position="top-right" closeButton />
            </BrandProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
