import { getFormPool, sql } from "@/lib/db/mssql";

/** Pool for the Accounting form tables (stored in the Form Portal database). */
export const getAccPool = getFormPool;
export { sql };
