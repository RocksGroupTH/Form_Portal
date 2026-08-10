import { getFormPool, sql } from "@/lib/db/mssql";

/** Pool for the Accounting form tables (stored in Fast_Form). */
export const getAccPool = getFormPool;
export { sql };
