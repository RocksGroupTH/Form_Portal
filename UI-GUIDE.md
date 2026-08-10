# @rocks/ui — Rocks Group Design System & App Blueprint

> Reusable UI guide for building new web applications in the Rocks Group ecosystem.
> Copy this file into any new project so AI assistants follow the same design language.
> This snapshot reflects **Form Portal**'s current implementation — the **Sky** palette
> (`light` / `dark` themes), 14px card radius, 12px tile radius, and capsule nav. Swap the
> palette section for whichever brand colours the next project needs; the structural and
> component guidance below applies regardless of palette.

---

## 1. Tech Stack (Recommended)

| Layer | Package | Why |
|-------|---------|-----|
| Framework | Next.js (App Router) | SSR, file-based routing, API routes |
| UI | React 19+ | Latest features, server components |
| Language | TypeScript | Type safety |
| Styling | Tailwind CSS 4 | CSS-first config, no JS config file |
| Database | mssql | SQL Server driver for Node.js |
| Auth | next-auth 5 (beta) | Microsoft Entra ID (Azure AD) SSO |
| Validation | zod | Schema validation for forms & API |
| Forms | react-hook-form + @hookform/resolvers | Performant forms with Zod integration |
| Data Fetching | swr | Stale-while-revalidate client caching |
| Icons | lucide-react | Consistent, tree-shakable icons |
| Toasts | sonner | Lightweight toast notifications |
| Dates | date-fns | Date formatting & manipulation |
| Dialogs | @radix-ui/react-dialog | Accessible modals |
| Dropdowns | @radix-ui/react-dropdown-menu | Accessible context menus |
| Env Vars | @t3-oss/env-nextjs | Type-safe env with Zod validation |

**Install command:**
```bash
npm i next react react-dom typescript tailwindcss @tailwindcss/postcss \
  mssql next-auth zod react-hook-form @hookform/resolvers swr \
  lucide-react sonner date-fns @radix-ui/react-dialog @radix-ui/react-dropdown-menu \
  @t3-oss/env-nextjs
```

---

## 2. Project Structure Template

```
src/
├── app/
│   ├── (auth)/                  # Login, unauthorized pages
│   ├── (dashboard)/             # Protected routes (wrap with RouteGuard)
│   │   ├── layout.tsx           # Sidebar + Navbar layout
│   │   └── [feature]/page.tsx   # Feature pages
│   ├── api/                     # API routes
│   │   └── [domain]/route.ts
│   ├── globals.css              # @theme tokens + CSS variables
│   └── layout.tsx               # Root layout (providers)
│
├── features/                    # Feature modules
│   └── [feature]/
│       ├── components/
│       ├── hooks/
│       └── schemas.ts           # Zod schemas
│
├── components/
│   ├── ui/                      # Design system (see Section 6)
│   │   ├── Avatar.tsx
│   │   ├── Badge.tsx
│   │   ├── Button.tsx
│   │   ├── Dialog.tsx
│   │   ├── DropdownMenu.tsx
│   │   ├── FullScreenModal.tsx
│   │   ├── SidePanel.tsx
│   │   └── index.ts
│   └── layout/                  # Navbar, Sidebar, RouteGuard
│
├── lib/
│   ├── db/mssql.ts              # DB pool + fixThaiDate()
│   ├── api/client.ts            # Fetch wrapper
│   ├── auth.ts                  # NextAuth config (Node runtime)
│   ├── auth.config.ts           # Edge-safe auth config
│   ├── api-auth.ts              # requireAuth(), requireRole()
│   ├── graph.ts                 # Microsoft Graph API helpers
│   ├── form.ts                  # Re-exports: useForm, zodResolver, z
│   ├── constants.ts             # Nav items, colors, enums
│   ├── types.ts                 # Shared TypeScript types
│   └── hooks/
│       ├── useIsMobile.ts
│       ├── useRole.ts
│       └── useSwipeToClose.ts
│
├── env.ts                       # Validated env vars
└── proxy.ts                     # Middleware
```

---

## 3. Authentication — Microsoft Entra ID

### Setup

Two auth config files for Edge/Node split:

**`auth.config.ts`** (Edge runtime — used by middleware):
```typescript
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

export const authConfig = {
  providers: [
    MicrosoftEntraID({
      clientId: env.AZURE_AD_CLIENT_ID,
      clientSecret: env.AZURE_AD_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/v2.0`,
      authorization: {
        params: { scope: "openid profile email User.Read" },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
};
```

**`auth.ts`** (Node runtime — full config with DB callbacks):
```typescript
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    async signIn({ user }) {
      // Look up user in your DB (e.g., TeamMember table)
      // Return true to allow, false/redirect URL to deny
    },
    async jwt({ token, user }) {
      // Attach role, nickname, etc. from DB to token
    },
    async session({ session, token }) {
      // Map token claims to session.user
    },
  },
});
```

### Session Shape

```typescript
type Role = "Staff" | "IT Admin" | "System Admin" | "Viewer";

// session.user contains:
interface SessionUser {
  id: string;           // DB primary key
  name: string;         // From Azure AD
  email: string;        // From Azure AD
  role: Role;           // From your DB
  nickname: string;     // Short display name
  color: string;        // User's assigned color (hex)
  photo: string | null; // Profile photo
}
```

### Middleware (`proxy.ts`)

```typescript
import { auth } from "./lib/auth.config";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isPublicRoute = req.nextUrl.pathname.startsWith("/api/auth")
    || req.nextUrl.pathname.startsWith("/login");

  if (!isLoggedIn && !isPublicRoute) {
    return Response.redirect(new URL("/login", req.url));
  }
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
```

### API Route Protection

```typescript
// lib/api-auth.ts
import { auth } from "./auth";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return session;
}

export async function requireRole(allowedRoles: Role[]) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!allowedRoles.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

// Usage:
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  // session.user is available
}
```

### Teams SSO (Optional)

If embedding in Microsoft Teams:
1. Teams SDK provides `ssoToken` query param
2. Server validates against Azure JWKS
3. Encodes NextAuth session cookie on redirect
4. Strip token from URL after exchange

### Required Env Vars

```env
AUTH_SECRET=           # NextAuth encryption key (generate with `openssl rand -base64 32`)
AZURE_AD_CLIENT_ID=    # Azure App Registration
AZURE_AD_CLIENT_SECRET=
AZURE_AD_TENANT_ID=
```

---

## 4. Database — MSSQL

### Connection Pool

```typescript
// lib/db/mssql.ts
import sql from "mssql";
import { env } from "@/env";

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool({
      server: env.MSSQL_HOST,
      port: env.MSSQL_PORT,
      database: env.MSSQL_DATABASE,
      user: env.MSSQL_USER,
      password: env.MSSQL_PASSWORD,
      options: {
        encrypt: env.MSSQL_ENCRYPT,
        trustServerCertificate: env.MSSQL_TRUST_CERT,
      },
      pool: { max: 10, idleTimeoutMillis: 30000 },
    }).connect();
  }
  return poolPromise;
}

export { sql };
```

### Thailand Timezone — fixThaiDate()

MSSQL DATETIME2 has no timezone. If your server stores local time (UTC+7), Node.js reads it as UTC:

```typescript
export function fixThaiDate(d: Date | string | null): Date | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return new Date(date.getTime() + 7 * 60 * 60 * 1000);
}
```

**Always call `fixThaiDate()`** on DATETIME2 columns from the main DB.

### Query Patterns

```typescript
// Parameterized query (injection-safe)
const pool = await getPool();
const result = await pool.request()
  .input("id", sql.Int, id)
  .input("name", sql.NVarChar, name)
  .query(`SELECT * FROM Users WHERE Id = @id AND Name = @name`);

// Insert with OUTPUT
const insert = await pool.request()
  .input("title", sql.NVarChar, title)
  .query(`INSERT INTO Items (Title) OUTPUT INSERTED.Id VALUES (@title)`);
const newId = insert.recordset[0].Id;

// Transaction
const tx = pool.transaction();
await tx.begin();
try {
  await tx.request().input("id", sql.Int, id).query(`DELETE FROM Items WHERE Id = @id`);
  await tx.commit();
} catch (err) {
  await tx.rollback();
  throw err;
}
```

### Required Env Vars

```env
MSSQL_HOST=localhost
MSSQL_PORT=1433
MSSQL_DATABASE=MyApp
MSSQL_USER=sa
MSSQL_PASSWORD=
MSSQL_ENCRYPT=false
MSSQL_TRUST_CERT=true
```

---

## 5. Tailwind CSS 4 — Theme System

### Setup

No `tailwind.config.ts`. All tokens go in `globals.css`:

```css
/* postcss.config.mjs */
export default { plugins: { "@tailwindcss/postcss": {} } };
```

### Sky Brand Colors (Form Portal)

**Corporate identity:**

| Token | Hex | Use |
|-------|-----|-----|
| `--color-brand-navy` | `#1b2434` | Signature dark (sidebar, headings) |
| `--color-brand-navy-light` | `#2b3446` | Navy hover/alt |
| `--color-brand-red` | `#4c74c4` | Primary CTA, accent (kept the `-red` token name for drop-in compatibility with the old palette; it now holds the Sky accent blue) |
| `--color-brand-light` | `#e8effc` | Pale-blue backgrounds |
| `--color-brand-border` | `#dbe6f8` | Cool border accent |

**Shape & depth (modern treatment — replaces the old heavy-border look):**

| Token | Value | Use |
|-------|-------|-----|
| `--radius-card` | `14px` | Cards, panels, modals |
| `--radius-tile` | `12px` | Icon tiles, smaller surfaces |
| `--radius-full` | `999px` | Pills, badges, capsule nav |
| `--shadow-card` | `0 2px 8px -3px rgba(59,79,116,.16)` (light) / darker in `dark` | Default card elevation — **prefer this over a heavy `1px solid` border** |
| `--shadow-lift` | `0 12px 32px -12px rgba(59,79,116,.28)` | Hover/lift elevation on interactive cards |
| `--nav-active-bg` / `--nav-active-text` | tinted accent pair | Tinted icon tiles: icon sits on `--nav-active-bg`, coloured with `--nav-active-text`, instead of a flat grey chip |
| Nav shape | `--radius-full` | The top nav renders as a capsule (pill), not a squared bar |
| `--mark-from` / `--mark-to` | gradient stops | Brand mark gradient (logo mark, avatar fallback, loading accents) |
| `--status-{pending,ok,draft,bad}-{bg,text}` | tinted pairs | Status pills — tinted background + matching text, not solid fills |

Practical rule: reach for `--shadow-card` + `--radius-card` before reaching for a border. Borders (`--border-card`) are for definition on flat surfaces (table rows, list dividers), not for lifting a card off the page.

---

### @theme Tokens (Copy to `globals.css`)

```css
@import "tailwindcss";

@theme {
  /* ── Sky Brand (Form Portal) ── */
  --color-brand-navy: #1b2434;
  --color-brand-navy-light: #2b3446;
  --color-brand-red: #4c74c4;
  --color-brand-light: #e8effc;
  --color-brand-border: #dbe6f8;

  /* ── Status Colors ── */
  --color-status-red: #e74c3c;
  --color-status-blue: #3498db;
  --color-status-green: #27ae60;
  --color-status-teal: #16a085;
  --color-status-purple: #8e44ad;
  --color-status-orange: #f39c12;

  /* ── Semantic Actions ── */
  --color-action: #2563eb;
  --color-action-hover: #1d4ed8;
  --color-success: #16a34a;
  --color-success-light: #22c55e;
  --color-danger: #dc2626;
  --color-danger-hover: #b91c1c;
  --color-warning: #d97706;
  --color-warning-light: #f59e0b;
  --color-purple: #7c3aed;
  --color-indigo: #6366f1;
  --color-muted-gray: #64748b;

  /* ── Typography (compact scale) ── */
  --text-2xs: 9px;
  --text-xs: 10px;
  --text-sm: 11px;
  --text-md: 12px;
  --text-base: 13px;
  --text-lg: 14px;
  --text-xl: 16px;
  --text-2xl: 20px;

  /* ── Spacing ── */
  --space-0: 0px;
  --space-0\.5: 2px;
  --space-1: 4px;
  --space-1\.5: 6px;
  --space-2: 8px;
  --space-2\.5: 10px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  /* ── Border Radius ── */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-2xl: 20px;
  --radius-full: 9999px;

  /* ── Font ── */
  /* Form Portal self-hosts Noto Sans Thai (src/assets/fonts, next/font/local in layout.tsx).
     Fall back to a generic system stack for a fresh project without that font. */
  --font-sans: var(--font-noto-thai), var(--font-noto), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;

  /* ── Motion ── */
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out-back: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-spring: cubic-bezier(0.22, 1.2, 0.36, 1);
  --duration-fast: 120ms;
  --duration-normal: 200ms;
  --duration-smooth: 300ms;
  --duration-slow: 400ms;
}
```

### Light Theme Variables

```css
:root,
[data-theme="light"] {
  --navbar-h: 48px;

  /* Backgrounds */
  --bg-page: #f4f7fc;
  --bg-card: #ffffff;
  --bg-card-hover: #f7f9fd;
  --bg-card-alt: #f4f7fc;
  --bg-input: #ffffff;
  --bg-sidebar: #1b2434;
  --bg-topbar: rgba(255, 255, 255, 0.78);
  --bg-modal: #ffffff;
  --bg-dropdown: #ffffff;
  --bg-row-stripe: #f9fbfe;
  --bg-selected: #e8effc;
  --bg-badge: #eef3fb;

  /* Text */
  --text-primary: #2b3446;
  --text-secondary: #4b566b;
  --text-muted: #687591;
  --text-faint: #8695ab;
  --text-heading: #1f2735;
  --text-inverse: #ffffff;

  /* Borders */
  --border-main: #e7edf6;
  --border-light: #eff3f9;
  --border-card: rgba(59, 79, 116, 0.08);
  --border-input: #dde5f0;
  --border-accent: #dbe6f8;
  --border-elevated: rgba(59, 79, 116, 0.14);

  /* Shadows — see "Shape & depth" above; prefer shadow-card over a heavy border */
  --shadow-sm: 0 1px 2px rgba(59, 79, 116, 0.06);
  --shadow-md: 0 2px 8px -3px rgba(59, 79, 116, 0.16);
  --shadow-xl: 0 12px 32px -12px rgba(59, 79, 116, 0.28);
  --shadow-card: 0 2px 8px -3px rgba(59, 79, 116, 0.16);
  --shadow-lift: 0 12px 32px -12px rgba(59, 79, 116, 0.28);

  --overlay-bg: rgba(31, 39, 53, 0.38);

  /* Radii — modern treatment */
  --radius-card: 14px;
  --radius-tile: 12px;

  /* Nav — tinted icon tiles, capsule nav */
  --nav-active-bg: rgba(76, 116, 196, 0.10);
  --nav-active-text: #4c74c4;

  /* Buttons */
  --btn-primary-bg: #4c74c4;
  --btn-primary-text: #ffffff;
  --btn-danger-bg: var(--color-danger);
  --btn-danger-text: #ffffff;
  --btn-ghost-bg: transparent;
  --btn-ghost-text: var(--text-secondary);
  --btn-ghost-hover: var(--bg-card-hover);

  /* Interactive accent */
  --accent: #4c74c4;
  --accent-hover: #3d63b0;

  /* Brand mark gradient */
  --mark-from: #7fa0e0;
  --mark-to: #5b7fc9;

  /* Status pills — tinted bg + matching text */
  --status-pending-bg: #e8effc;
  --status-pending-text: #4c74c4;
  --status-ok-bg: #e2f3e9;
  --status-ok-text: #3d8560;
  --status-draft-bg: #fdeee0;
  --status-draft-text: #b5793a;
  --status-bad-bg: #fce9e9;
  --status-bad-text: #c25b5b;

  /* Tooltip */
  --bg-tooltip: #2b3446;

  /* Info boxes */
  --bg-info-green: #eef8f2;
  --border-info-green: #cfe9dc;
  --text-info-green: #3d8560;
  --bg-info-yellow: #fdf6ec;
  --border-info-yellow: #f3ddbd;
  --text-info-yellow: #b5793a;

  /* Focus rings */
  --ring-action: 0 0 0 3px rgba(76, 116, 196, 0.22);
  --ring-danger: 0 0 0 3px rgba(194, 91, 91, 0.22);

  /* Shadows — elevated surfaces */
  --shadow-modal: 0 16px 48px -12px rgba(31, 39, 53, 0.22);
  --shadow-popover: 0 8px 24px -8px rgba(31, 39, 53, 0.18);
  --shadow-dropdown: 0 4px 16px -6px rgba(31, 39, 53, 0.16);
}
```

### Dark Theme Variables (Sky, night)

The dark theme is named `dark` — not `gold`, which was the original Rocks Fast dark-luxury theme name.

```css
[data-theme="dark"] {
  --bg-page: #0f1319;
  --bg-card: #161b23;
  --bg-card-hover: #1c222c;
  --bg-card-alt: #1a202a;
  --bg-input: #12171e;
  --bg-sidebar: #0c1015;
  --bg-topbar: rgba(22, 27, 35, 0.80);
  --bg-modal: #161b23;
  --bg-dropdown: #1a202a;
  --bg-row-stripe: #141920;
  --bg-selected: #1b2432;
  --bg-badge: #1f2630;

  --text-primary: #e6ecf5;
  --text-secondary: #b9c3d1;
  --text-muted: #8592a3;
  --text-faint: #5b6675;
  --text-heading: #f1f5fb;
  --text-inverse: #0f1319;

  --border-main: #262e3a;
  --border-light: #1e2530;
  --border-card: rgba(127, 160, 224, 0.12);
  --border-input: #333d4c;
  --border-accent: #2c3849;
  --border-elevated: rgba(127, 160, 224, 0.20);

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 16px -6px rgba(0, 0, 0, 0.5);
  --shadow-xl: 0 12px 32px -12px rgba(0, 0, 0, 0.6);
  --shadow-card: 0 2px 8px -3px rgba(0, 0, 0, 0.45);
  --shadow-lift: 0 12px 32px -12px rgba(0, 0, 0, 0.6);

  --overlay-bg: rgba(0, 0, 0, 0.65);

  --radius-card: 14px;
  --radius-tile: 12px;

  --nav-active-bg: rgba(127, 160, 224, 0.14);
  --nav-active-text: #9fb9e8;

  --btn-primary-bg: #5b7fc9;
  --btn-primary-text: #ffffff;
  --btn-danger-bg: #8f3b3b;
  --btn-danger-text: #fbdcdc;

  --accent: #7fa0e0;
  --accent-hover: #9fb9e8;

  --mark-from: #7fa0e0;
  --mark-to: #5b7fc9;

  --status-pending-bg: #1c2739;
  --status-pending-text: #9fb9e8;
  --status-ok-bg: #172b23;
  --status-ok-text: #7cc4a0;
  --status-draft-bg: #2e2418;
  --status-draft-text: #e8b96a;
  --status-bad-bg: #2f1d1d;
  --status-bad-text: #e29a9a;

  --bg-tooltip: #1f2630;

  --ring-action: 0 0 0 3px rgba(127, 160, 224, 0.30);
  --ring-danger: 0 0 0 3px rgba(226, 154, 154, 0.30);

  --shadow-modal: 0 16px 48px -12px rgba(0, 0, 0, 0.6);
  --shadow-popover: 0 8px 24px -8px rgba(0, 0, 0, 0.5);
  --shadow-dropdown: 0 4px 16px -6px rgba(0, 0, 0, 0.45);
}
```

### Theme Switching

```typescript
// components/ThemeProvider.tsx
"use client";
import { createContext, useContext, useState, useEffect } from "react";

type Theme = "light" | "dark";
const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}>({ theme: "light", toggleTheme: () => {}, setTheme: () => {} });

// Form Portal's actual storage key is "form-portal-theme" (src/components/ThemeProvider.tsx),
// set in both localStorage and a cookie so the no-flash script (below) and the server can read it.
const STORAGE_KEY = "form-portal-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (saved) { setThemeState(saved); document.documentElement.setAttribute("data-theme", saved); }
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    document.cookie = `${STORAGE_KEY}=${t}; path=/; max-age=31536000`;
    document.documentElement.setAttribute("data-theme", t);
  };

  const toggleTheme = () => setTheme(theme === "light" ? "dark" : "light");

  return <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
```

**Prevent flash** — add inline script in root `layout.tsx` before providers (reads localStorage first, falls back to the cookie, matching Form Portal's actual script):
```html
<html data-theme="light">
  <head>
    <script dangerouslySetInnerHTML={{ __html: `
      try {
        var t = localStorage.getItem("form-portal-theme");
        if (!t) { var m = document.cookie.match(/form-portal-theme=(light|dark)/); if (m) t = m[1]; }
        document.documentElement.setAttribute("data-theme", (t === "light" || t === "dark") ? t : "light");
      } catch (e) { document.documentElement.setAttribute("data-theme", "light"); }
    ` }} />
  </head>
```

---

## 6. UI Components (Copy-Ready)

### Button

```tsx
// components/ui/Button.tsx
"use client";
import React, { useMemo } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "none" },
  secondary: {
    background: "color-mix(in srgb, var(--bg-card) 80%, transparent)",
    color: "var(--text-primary)", border: "1px solid var(--border-card)",
  },
  ghost: { background: "transparent", color: "var(--text-secondary)", border: "1px solid transparent" },
  danger: { background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "none" },
  icon: { background: "transparent", color: "var(--text-muted)", border: "none", padding: 0 },
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "text-[11px] px-2 py-1 rounded-lg",
  md: "text-[13px] px-3 py-1.5 rounded-xl",
  lg: "text-[14px] px-4 py-2 rounded-xl",
};

export const Button = React.memo(
  React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = "secondary", size = "md", loading, icon, children, className = "", style, disabled, ...props },
    ref
  ) {
    const isIcon = variant === "icon";
    const sizeClass = isIcon ? "w-8 h-8 rounded-lg flex items-center justify-center" : sizeClasses[size];
    const liftClass = variant === "primary" || variant === "secondary" ? "btn-lift" : "";
    const merged = useMemo(() => (style ? { ...variantStyles[variant], ...style } : variantStyles[variant]), [variant, style]);

    return (
      <button ref={ref}
        className={`font-bold cursor-pointer inline-flex items-center justify-center gap-1.5 transition-opacity shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${liftClass} ${sizeClass} ${className}`}
        style={merged} disabled={disabled || loading} {...props}
      >
        {loading ? <span className="inline-block w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: "currentColor", borderTopColor: "transparent" }} />
          : icon ? icon : null}
        {children}
      </button>
    );
  })
);
```

**Usage:**
```tsx
<Button variant="primary" onClick={save}>Save</Button>
<Button variant="danger" loading={deleting}>Delete</Button>
<Button variant="ghost" size="sm" icon={<Plus size={14} />}>Add</Button>
<Button variant="icon"><Settings size={16} /></Button>
```

### Badge

```tsx
// components/ui/Badge.tsx
"use client";
import React from "react";

export const Badge = React.memo(function Badge({
  label, color, bg, border, small,
}: { label: string; color: string; bg?: string; border?: string; small?: boolean }) {
  return (
    <span
      className={`inline-block font-bold rounded-lg whitespace-nowrap text-center gold-badge-glow transition-shadow ${
        small ? "text-[11px] px-2 py-[2px]" : "text-[12px] px-2.5 py-0.5"
      }`}
      style={{
        backgroundColor: bg ?? `${color}12`,
        border: border ?? `1px solid ${color}35`,
        color,
      }}
    >
      {label.trim()}
    </span>
  );
});
```

### Avatar

```tsx
// components/ui/Avatar.tsx
"use client";

export function Avatar({ name, color = "#1b2434", size = 32, photo }: {
  name: string; color?: string; size?: number; photo?: string | null;
}) {
  if (photo) {
    return <img src={photo} alt={name} className="rounded-full shrink-0 object-cover"
      style={{ width: size, height: size }} />;
  }
  return (
    <div className="rounded-full flex items-center justify-center font-bold shrink-0"
      style={{ width: size, height: size, background: color, color: "#fff", fontSize: size * 0.35 }}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}
```

### Dialog (Modal)

```tsx
// components/ui/Dialog.tsx
"use client";
import React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export function Dialog({ open, onOpenChange, title, description, children, contentClassName = "" }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  title?: string; description?: string; children: React.ReactNode; contentClassName?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50"
          style={{ backgroundColor: "var(--overlay-bg)", animation: "overlayFadeIn 0.15s ease-out" }} />
        <RadixDialog.Content
          className={`fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-xl border p-6 shadow-xl ${contentClassName}`}
          style={{ backgroundColor: "var(--bg-modal)", borderColor: "var(--border-main)", animation: "dialogIn 0.2s var(--ease-out-expo)" }}
        >
          {title && <RadixDialog.Title className="text-lg font-semibold mb-4" style={{ color: "var(--text-heading)" }}>{title}</RadixDialog.Title>}
          {description && <RadixDialog.Description className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{description}</RadixDialog.Description>}
          {children}
          <RadixDialog.Close className="absolute right-4 top-4 rounded-lg p-1 opacity-70 hover:opacity-100"
            style={{ color: "var(--text-muted)" }} aria-label="Close">
            <X className="h-5 w-5" />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
```

### SidePanel (Slide-out Detail)

```tsx
// components/ui/SidePanel.tsx
"use client";
import React, { useEffect, useRef, useMemo } from "react";
import { X } from "lucide-react";

export const SidePanel = React.memo(function SidePanel({
  open, onClose, width = "65%", children, zIndex = 40,
}: { open: boolean; onClose: () => void; width?: string; children: React.ReactNode; zIndex?: number }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", handler); document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0" style={{ zIndex, background: "var(--overlay-bg)" }} onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 flex flex-col"
        style={{ width, maxWidth: "100vw", zIndex: zIndex + 1, background: "var(--bg-card)",
          borderLeft: "1px solid var(--border-main)", animation: "slideInRight 0.25s ease-out" }}>
        {children}
      </div>
    </>
  );
});

export const SidePanelClose = React.memo(function SidePanelClose({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-6 h-6 flex items-center justify-center rounded-md cursor-pointer shrink-0"
      style={{ color: "var(--text-muted)", background: "transparent", border: "none" }} aria-label="Close panel">
      <X size={14} />
    </button>
  );
});
```

### FullScreenModal (Mobile)

```tsx
// components/ui/FullScreenModal.tsx
"use client";
import React, { useEffect, useRef, useMemo } from "react";
import { X } from "lucide-react";

export const FullScreenModal = React.memo(function FullScreenModal({
  open, onClose, title, children, zIndex = 50,
}: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; zIndex?: number }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", handler); document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex flex-col"
      style={{ zIndex, background: "var(--bg-page)", animation: "fullScreenSlideUp 0.25s var(--ease-out-expo)" }}>
      <div className="flex items-center justify-between shrink-0 px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--border-main)", background: "var(--bg-card)" }}>
        {title && <h2 className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>{title}</h2>}
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer ml-auto shrink-0"
          style={{ color: "var(--text-muted)", background: "transparent", border: "none" }} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
});
```

### DropdownMenu

```tsx
// components/ui/DropdownMenu.tsx
"use client";
import React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className = "", children, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content ref={ref}
      className={`min-w-[10rem] rounded-lg border py-1 shadow-lg ${className}`}
      style={{ backgroundColor: "var(--bg-dropdown)", borderColor: "var(--border-main)" }}
      sideOffset={4} {...props}>
      {children}
    </DropdownMenuPrimitive.Content>
  </DropdownMenuPrimitive.Portal>
));

const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className = "", ...props }, ref) => (
  <DropdownMenuPrimitive.Item ref={ref}
    className={`relative flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${className}`}
    style={{ color: "var(--text-primary)" }} {...props} />
));

const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className = "", ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={`my-1 h-px ${className}`}
    style={{ backgroundColor: "var(--border-light)" }} {...props} />
));

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator };
```

### Barrel Export

```typescript
// components/ui/index.ts
export { Avatar } from "./Avatar";
export { Badge } from "./Badge";
export { Button } from "./Button";
export { Dialog } from "./Dialog";
export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "./DropdownMenu";
export { FullScreenModal } from "./FullScreenModal";
export { SidePanel, SidePanelClose } from "./SidePanel";
```

---

## 7. Required CSS Animations

Add these to `globals.css` after theme variables:

```css
body {
  font-family: var(--font-sans);
  background: var(--bg-page);
  color: var(--text-primary);
  margin: 0;
  transition: background-color 0.25s ease, color 0.25s ease;
}

* { box-sizing: border-box; }

/* Prevent iOS auto-zoom on inputs */
@media screen and (max-width: 767px) {
  input, textarea, select { font-size: 16px !important; }
}

/* Smooth theme transitions */
[data-theme] * {
  transition-property: background-color, border-color, color, box-shadow;
  transition-duration: 0.15s;
  transition-timing-function: ease;
}

/* btn-lift: hover lift for primary/secondary buttons */
.btn-lift {
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.18s ease;
}
.btn-lift:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.10), 0 1px 3px rgba(0, 0, 0, 0.06);
}
.btn-lift:active:not(:disabled) {
  transform: translateY(0); box-shadow: none;
}

/* Dark badge hover glow — class name kept as "gold-badge-glow" in Form Portal's actual
   globals.css (harmless leftover name from the Rocks Fast original); only the theme
   selector changed from [data-theme="gold"] to [data-theme="dark"]. */
[data-theme="dark"] .gold-badge-glow:hover {
  box-shadow: 0 0 8px rgba(127, 160, 224, 0.25), 0 0 2px rgba(127, 160, 224, 0.15);
}
[data-theme="light"] .gold-badge-glow:hover {
  box-shadow: 0 0 6px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04) inset;
}

/* Dark input focus */
[data-theme="dark"] input:focus, [data-theme="dark"] textarea:focus, [data-theme="dark"] select:focus {
  border-color: #7fa0e0 !important;
  box-shadow: 0 0 0 2px rgba(127, 160, 224, 0.12), inset 0 0 8px rgba(127, 160, 224, 0.04) !important;
}

/* Dark primary button glow */
[data-theme="dark"] .btn-lift:hover:not(:disabled) {
  box-shadow: 0 0 8px rgba(127, 160, 224, 0.25), 0 2px 12px rgba(127, 160, 224, 0.1) !important;
}

/* Dark scrollbar */
[data-theme="dark"] ::-webkit-scrollbar { width: 8px; height: 8px; }
[data-theme="dark"] ::-webkit-scrollbar-track { background: var(--bg-card); }
[data-theme="dark"] ::-webkit-scrollbar-thumb { background: #2a3340; border-radius: 4px; }
[data-theme="dark"] ::-webkit-scrollbar-thumb:hover { background: #38434f; }

/* Slim scrollbar utility */
.slim-scroll { scrollbar-width: thin; scrollbar-color: transparent transparent; }
.slim-scroll:hover { scrollbar-color: rgba(150,150,160,0.35) transparent; }

/* Animations */
@keyframes dialogIn {
  from { opacity: 0; transform: scale(0.96) translateY(4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes overlayFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes fullScreenSlideUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes popoverEnter {
  from { opacity: 0; transform: scale(0.95) translateY(-4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes dropdownIn {
  from { opacity: 0; transform: translateY(-4px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* Hide scrollbar utility */
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
.no-scrollbar::-webkit-scrollbar { display: none; }

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 8. API Conventions

### Response Format

```typescript
// Success
NextResponse.json({ ok: true, data: result })

// Error
NextResponse.json({ ok: false, error: "Description" }, { status: 400 })
```

### Validation

```typescript
import { z } from "zod";

const schema = z.object({
  title: z.string().min(1),
  status: z.enum(["open", "closed"]),
});

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0].message }, { status: 400 });
  }
  // ... use parsed.data
}
```

### Error Handling

```typescript
try { /* ... */ } catch (err: unknown) {
  console.error("[api/feature]", err);
  return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
}
```

---

## 9. Form Pattern

```typescript
// lib/form.ts — convenience re-exports
export { useForm, useController, useFormContext } from "react-hook-form";
export { zodResolver } from "@hookform/resolvers/zod";
export { z } from "zod";
```

```tsx
import { useForm, zodResolver, z } from "@/lib/form";
import { Button } from "@/components/ui";
import { toast } from "sonner";

const schema = z.object({ name: z.string().min(1), email: z.string().email() });

function MyForm() {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "" },
  });

  return (
    <form onSubmit={handleSubmit(async (data) => {
      const res = await fetch("/api/users", { method: "POST", body: JSON.stringify(data) });
      if (res.ok) toast.success("Saved!"); else toast.error("Failed");
    })}>
      <input {...register("name")} />
      {errors.name && <span style={{ color: "var(--color-danger)" }}>{errors.name.message}</span>}
      <Button type="submit" variant="primary">Save</Button>
    </form>
  );
}
```

---

## 10. Mobile / Responsive

| Rule | Implementation |
|------|---------------|
| Breakpoint | 768px (`md:`) — single breakpoint strategy |
| Detection | `useIsMobile()` hook (SSR-safe, returns `false` on server) |
| Desktop detail | `<SidePanel width="65%">` |
| Mobile detail | `<FullScreenModal>` |
| Touch targets | min 48px height, `touch-manipulation`, `active:scale-95` |
| Bottom nav | Fixed 72px, `env(safe-area-inset-bottom)` for notch |
| Layout padding | `pb-24 md:pb-6` (extra bottom for mobile nav) |
| Swipe dismiss | `useSwipeToClose` (80px threshold) |

---

## 11. Microsoft Graph API (SharePoint, AD)

### Setup

```typescript
// lib/graph.ts
async function getGraphToken(): Promise<string> {
  // OAuth 2.0 client credentials flow
  // POST to https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
  // scope: https://graph.microsoft.com/.default
  // Cache token in memory with 60s buffer before expiry
}
```

### SharePoint File Upload

```typescript
export async function uploadToOneDrive(folderPath: string, fileName: string, buffer: Buffer, contentType: string) {
  // < 4MB: single PUT to /drive/items/root:/{path}/{file}:/content
  // > 4MB: create upload session, chunk in 4MB blocks
}

export async function createOneDriveShareLink(itemId: string): Promise<string> { /* org-wide view */ }
export async function deleteFromOneDrive(itemId: string): Promise<void> { /* DELETE drive item */ }
export async function getOneDriveDownloadUrl(itemId: string): Promise<string> { /* short-lived URL */ }
```

### AD User Search

```typescript
export async function searchADUsers(query: string) { /* GET /users?$filter=... */ }
export async function getADUserPhoto(userId: string) { /* GET /users/{id}/photo/$value → base64 */ }
```

---

## 12. Design Rules Summary

1. **Use CSS variables** — `var(--bg-card)`, never raw `#fbfafa`
2. **Use `<Button>`** — never raw `<button>` with manual styling
3. **Use `<SidePanel>`** — never custom fixed-position panel divs
4. **Use `<Dialog>`** — never custom modal implementations
5. **Border radius** — `var(--radius-md)`, never raw `8px`
6. **Icons** — `lucide-react` only, never inline SVGs
7. **Toasts** — `sonner` only: `toast.success()`, `toast.error()`
8. **Font sizes** — use `var(--text-base)` scale, never raw pixel values
9. **Status colors in data** — hex in constants.ts is fine (data mappings, not UI)
10. **Server components** by default — `"use client"` only when needed
11. **SQL injection** — `.input()` parameterized queries only
12. **fixThaiDate()** — always on DATETIME2 columns
13. **Mobile test** — always test both paths for layout/panels/navigation
