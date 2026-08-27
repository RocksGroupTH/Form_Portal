import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main(): Promise<number> {
  if (!process.argv.includes("--production")) {
    console.error("Refusing to sync BC Production without --production");
    return 2;
  }

  const { syncAllBrandErpVendors, syncBrandErpVendors } = await import("@/lib/erp/vendor-sync");

  const brandArg = process.argv.find((arg) => arg.startsWith("--brand="));
  if (brandArg) {
    const brandCode = brandArg.slice("--brand=".length).trim().toUpperCase();
    if (!brandCode) throw new Error("--brand requires a value");
    const result = await syncBrandErpVendors(brandCode, null);
    console.log(JSON.stringify({ results: [result], errors: [] }, null, 2));
    return 0;
  }

  const result = await syncAllBrandErpVendors(null);
  console.log(JSON.stringify(result, null, 2));
  return result.errors.length === 0 ? 0 : 1;
}

void main()
  .then(async (exitCode) => {
    process.exitCode = exitCode;
    const { closeDatabasePools } = await import("@/lib/db/mssql");
    await closeDatabasePools();
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : "Vendor sync failed");
    process.exitCode = 1;
    const { closeDatabasePools } = await import("@/lib/db/mssql");
    await closeDatabasePools();
  });
