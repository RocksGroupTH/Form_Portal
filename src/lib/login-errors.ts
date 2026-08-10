/** Human-readable login error messages (NextAuth ?error= codes) */
export function getLoginErrorMessage(code: string | null | undefined): string {
  if (!code) return "";

  const messages: Record<string, string> = {
    AccessDenied:
      "ไม่สามารถเข้าสู่ระบบได้ — บัญชีของคุณยังไม่ได้รับอนุญาต หรือระบบตรวจสอบไม่ผ่าน กรุณาติดต่อผู้ดูแลระบบ",
    Configuration:
      "การตั้งค่าเข้าสู่ระบบไม่ถูกต้อง (Azure AD) กรุณาติดต่อทีม IT",
    Verification:
      "ลิงก์ยืนยันหมดอายุหรือถูกใช้แล้ว กรุณาลองเข้าสู่ระบบใหม่",
    OAuthSignin:
      "ไม่สามารถเชื่อมต่อ Microsoft ได้ กรุณาลองใหม่อีกครั้ง",
    OAuthCallback:
      "เกิดข้อผิดพลาดหลังยืนยันตัวตนกับ Microsoft กรุณาลองใหม่",
    OAuthCreateAccount:
      "ไม่สามารถสร้างบัญชีจาก Microsoft ได้ กรุณาติดต่อผู้ดูแลระบบ",
    Callback:
      "เกิดข้อผิดพลาดระหว่างเข้าสู่ระบบ กรุณาลองใหม่",
    CredentialsSignin:
      "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    SessionRequired:
      "กรุณาเข้าสู่ระบบก่อนใช้งานหน้านี้",
    DatabaseConnection:
      "ไม่สามารถเชื่อมต่อฐานข้อมูลได้ — ตรวจสอบ MSSQL_USER / MSSQL_PASSWORD ใน .env.local แล้วรีสตาร์ท npm run dev",
    Default:
      "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  };

  return messages[code] ?? messages.Default;
}

/** Map raw errors (e.g. from SQL Server) to a login error code */
export function classifyLoginError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/login failed for user/i.test(msg) || /connection.*refused|ETIMEOUT|ECONNREFUSED/i.test(msg)) {
    return "DatabaseConnection";
  }
  return "Default";
}

/** Extract SQL username from "Login failed for user 'xxx'" for clearer UI */
export function formatSqlLoginError(message: string, expectedUser?: string): string {
  const match = /login failed for user '([^']+)'/i.exec(message);
  if (!match) return message;
  const failedUser = match[1];
  if (expectedUser && failedUser.toLowerCase() !== expectedUser.toLowerCase()) {
    return `SQL Server rejected user '${failedUser}' (app .env uses '${expectedUser}'). Restart dev server after changing .env.local, or fix the connection username in Settings.`;
  }
  return `SQL Server rejected login for user '${failedUser}'. Check username and password.`;
}

export function isNextRedirectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as { digest?: string }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
