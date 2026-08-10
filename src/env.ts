import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    AUTH_SECRET: z.string().min(1),
    MSSQL_HOST: z.string().default("localhost"),
    MSSQL_PORT: z.coerce.number().default(1433),
    MSSQL_DATABASE: z.string().min(1),
    MSSQL_CORE_DATABASE: z.string().default("Fast_Core"),
    MSSQL_FORM_DATABASE: z.string().default("Fast_Form"),
    MSSQL_DATA_DATABASE: z.string().default("Fast_Data"),
    MSSQL_USER: z.string().min(1),
    MSSQL_PASSWORD: z.string().min(1),
    MSSQL_ENCRYPT: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    MSSQL_TRUST_CERT: z
      .string()
      .optional()
      .transform((v) => v !== "false"),
    MSSQL_TLS_SERVER_NAME: z.string().optional(),
    AZURE_AD_CLIENT_ID: z.string().optional(),
    AZURE_AD_CLIENT_SECRET: z.string().optional(),
    AZURE_AD_TENANT_ID: z.string().optional(),
    GRAPH_MAIL_FROM: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    GOOGLE_AI_API_KEY: z.string().optional(),
    FOODSTORY_DB_HOST: z.string().optional(),
    FOODSTORY_BRANDS: z
      .string()
      .optional()
      .transform((v) => {
        if (!v) return undefined;
        try { return JSON.parse(v) as Record<string, string>; } catch { return undefined; }
      }),
    ORS_API_KEY: z.string().optional(),
    GOOGLE_MAPS_API_KEY: z.string().optional(),
    CONNECTION_ENCRYPTION_KEY: z.string().optional(),
    SHAREPOINT_ACC_SITE: z.string().optional(),
    SHAREPOINT_ACC_FOLDER: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional(),
  },
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    MSSQL_HOST: process.env.MSSQL_HOST,
    MSSQL_PORT: process.env.MSSQL_PORT,
    MSSQL_DATABASE: process.env.MSSQL_DATABASE,
    MSSQL_CORE_DATABASE: process.env.MSSQL_CORE_DATABASE,
    MSSQL_FORM_DATABASE: process.env.MSSQL_FORM_DATABASE,
    MSSQL_DATA_DATABASE: process.env.MSSQL_DATA_DATABASE,
    MSSQL_USER: process.env.MSSQL_USER,
    MSSQL_PASSWORD: process.env.MSSQL_PASSWORD,
    MSSQL_ENCRYPT: process.env.MSSQL_ENCRYPT,
    MSSQL_TRUST_CERT: process.env.MSSQL_TRUST_CERT,
    MSSQL_TLS_SERVER_NAME: process.env.MSSQL_TLS_SERVER_NAME,
    AZURE_AD_CLIENT_ID: process.env.AZURE_AD_CLIENT_ID,
    AZURE_AD_CLIENT_SECRET: process.env.AZURE_AD_CLIENT_SECRET,
    AZURE_AD_TENANT_ID: process.env.AZURE_AD_TENANT_ID,
    GRAPH_MAIL_FROM: process.env.GRAPH_MAIL_FROM,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
    FOODSTORY_DB_HOST: process.env.FOODSTORY_DB_HOST,
    FOODSTORY_BRANDS: process.env.FOODSTORY_BRANDS,
    ORS_API_KEY: process.env.ORS_API_KEY,
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
    CONNECTION_ENCRYPTION_KEY: process.env.CONNECTION_ENCRYPTION_KEY,
    SHAREPOINT_ACC_SITE: process.env.SHAREPOINT_ACC_SITE,
    SHAREPOINT_ACC_FOLDER: process.env.SHAREPOINT_ACC_FOLDER,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
