import { NextResponse } from "next/server";
import { getCorePool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/locations
 * Returns all stores + brands from Rocks_Codex (read-only).
 */
export async function GET() {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const pool = await getCorePool();

    // Fetch brands
    const brandsResult = await pool.request().query(`
      SELECT Id, Name, Code, Logo, IsActive
      FROM [Rocks_Codex].[dbo].[Brand] WITH (NOLOCK)
      ORDER BY Id
    `);

    // Map brand code → local processed logo (200x200, from Codex uploads)
    const BRAND_LOGOS: Record<string, string> = {
      ROCKS: "/brandlogo/rocks-200.png",
      Rocks: "/brandlogo/rocks-200.png",
      PCTH: "/brandlogo/pcth-200.png",
      PCMY: "/brandlogo/pcmy-200.png",
      KSI: "/brandlogo/ksi-200.png",
      KS: "/brandlogo/ksi-200.png",
      UNO: "/brandlogo/uno-200.png",
      HipHut: "/brandlogo/hiphut-200.png",
    };

    const brands = brandsResult.recordset.map((r: Record<string, unknown>) => {
      const code = r.Code as string;
      return {
        id: r.Id as number,
        name: r.Name as string,
        code,
        logo: BRAND_LOGOS[code] || null,
        isActive: r.IsActive as boolean,
      };
    });

    // Fetch stores via Location LEFT JOIN StoreMaster (all columns)
    const storesResult = await pool.request().query(`
      SELECT
        COALESCE(SM.Id, 0) AS Id,
        L.Id AS LocationId,
        L.Name AS LocationName,
        L.Code AS LocationCode,
        L.BrandId AS LocationBrandId,
        L.[Type] AS LocationType,
        B.Code AS BrandCode,
        SM.ShopCode, SM.Year, SM.StoreName, SM.StoreNameEn, SM.StoreNameTh,
        SM.StoreFormat, SM.StoreType, SM.StoreTypeMKT, SM.Company,
        SM.Region, SM.Province, SM.District, SM.ShopClass, SM.Floor, SM.RoomNo,
        SM.Zone, SM.Address, SM.Phone,
        SM.Lat, SM.[Long], SM.StoreSize, SM.StockSize,
        SM.Status, SM.OpeningDate, SM.SeatCount,
        SM.OpenTimeWeekday, SM.CloseTimeWeekday,
        SM.OpenTimeWeekend, SM.CloseTimeWeekend,
        SM.OpenTimeDelivery, SM.CloseTimeDelivery,
        SM.AreaManagerName, SM.AreaManagerPhone,
        SM.TeamLeaderName, SM.TeamLeaderPhone,
        SM.InternetProvider, SM.PowerSpec, SM.WaterSupply, SM.WasteWater,
        SM.ExhaustCFM, SM.GasSystem, SM.Hood, SM.MeNote,
        SM.MenuType, SM.DrinkMenu, SM.PriceList,
        SM.CashierSerialNo, SM.CashRDNo, SM.RevenueDeptBranchCode, SM.VatRegister
      FROM [Rocks_Codex].[dbo].[Location] L WITH (NOLOCK)
      LEFT JOIN [Rocks_Codex].[dbo].[StoreMaster] SM WITH (NOLOCK) ON SM.LocationId = L.Id
      LEFT JOIN [Rocks_Codex].[dbo].[Brand] B WITH (NOLOCK) ON B.Id = L.BrandId
      WHERE L.IsActive = 1
      ORDER BY L.Code
    `);

    // Collect StoreMaster IDs for child table queries
    const smIds = storesResult.recordset
      .map((r: Record<string, unknown>) => r.Id as number)
      .filter((id) => id > 0);

    // Fetch child tables in parallel (only if we have StoreMaster rows)
    type ChildRow = Record<string, unknown>;
    let dpRows: ChildRow[] = [];
    let eqRows: ChildRow[] = [];
    let pmRows: ChildRow[] = [];
    let prRows: ChildRow[] = [];

    if (smIds.length > 0) {
      // Build parameterized IN clause to prevent SQL injection
      const addIdParams = (req: ReturnType<Awaited<ReturnType<typeof getCorePool>>["request"]>) => {
        smIds.forEach((id, i) => req.input(`id${i}`, sql.Int, id));
        return smIds.map((_, i) => `@id${i}`).join(",");
      };

      const dpReq = pool.request();
      const eqReq = pool.request();
      const pmReq = pool.request();
      const prReq = pool.request();
      const dpParams = addIdParams(dpReq);
      const eqParams = addIdParams(eqReq);
      const pmParams = addIdParams(pmReq);
      const prParams = addIdParams(prReq);

      const [dpRes, eqRes, pmRes, prRes] = await Promise.all([
        dpReq.query(`SELECT StoreMasterId, PlatformName, IsActive, MerchantId FROM [Rocks_Codex].[dbo].[StoreDeliveryPlatform] WITH (NOLOCK) WHERE StoreMasterId IN (${dpParams})`),
        eqReq.query(`SELECT StoreMasterId, Category, ItemName, Quantity FROM [Rocks_Codex].[dbo].[StoreEquipment] WITH (NOLOCK) WHERE StoreMasterId IN (${eqParams})`),
        pmReq.query(`SELECT StoreMasterId, MethodName, IsActive FROM [Rocks_Codex].[dbo].[StorePaymentMethod] WITH (NOLOCK) WHERE StoreMasterId IN (${pmParams})`),
        prReq.query(`SELECT StoreMasterId, ProductName, IsAvailable FROM [Rocks_Codex].[dbo].[StoreProduct] WITH (NOLOCK) WHERE StoreMasterId IN (${prParams})`),
      ]);
      dpRows = dpRes.recordset;
      eqRows = eqRes.recordset;
      pmRows = pmRes.recordset;
      prRows = prRes.recordset;
    }

    // Group child rows by StoreMasterId
    const groupBySmId = (rows: ChildRow[]): Map<number, ChildRow[]> => {
      const map = new Map<number, ChildRow[]>();
      for (const r of rows) {
        const id = r.StoreMasterId as number;
        let arr = map.get(id);
        if (!arr) { arr = []; map.set(id, arr); }
        arr.push(r);
      }
      return map;
    };
    const dpMap = groupBySmId(dpRows);
    const eqMap = groupBySmId(eqRows);
    const pmMap = groupBySmId(pmRows);
    const prMap = groupBySmId(prRows);

    const stores = storesResult.recordset.map((r: Record<string, unknown>) => {
      const smId = r.Id as number;
      return {
        id: smId,
        locationId: r.LocationId as number | null,
        locationName: (r.LocationName as string) || "",
        locationCode: (r.LocationCode as string) || "",
        locationBrandId: r.LocationBrandId as number | null,
        locationType: r.LocationType as string | null,
        brandCode: r.BrandCode as string | null,
        shopCode: (r.ShopCode as string) || "",
        year: r.Year as number | null,
        storeName: r.StoreName as string | null,
        storeNameEn: r.StoreNameEn as string | null,
        storeNameTh: r.StoreNameTh as string | null,
        storeFormat: r.StoreFormat as string | null,
        storeType: r.StoreType as string | null,
        storeTypeMKT: r.StoreTypeMKT as string | null,
        company: r.Company as string | null,
        region: r.Region as string | null,
        province: r.Province as string | null,
        district: r.District as string | null,
        shopClass: r.ShopClass as string | null,
        floor: r.Floor as string | null,
        roomNo: r.RoomNo as string | null,
        zone: r.Zone as string | null,
        address: r.Address as string | null,
        phone: r.Phone as string | null,
        lat: r.Lat as number | null,
        long: r.Long as number | null,
        storeSize: r.StoreSize as number | null,
        stockSize: r.StockSize as number | null,
        status: r.Status as string | null,
        openingDate: r.OpeningDate ? (() => {
          const d = r.OpeningDate as Date;
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })() : null,
        seatCount: r.SeatCount as number | null,
        openTimeWeekday: r.OpenTimeWeekday as string | null,
        closeTimeWeekday: r.CloseTimeWeekday as string | null,
        openTimeWeekend: r.OpenTimeWeekend as string | null,
        closeTimeWeekend: r.CloseTimeWeekend as string | null,
        openTimeDelivery: r.OpenTimeDelivery as string | null,
        closeTimeDelivery: r.CloseTimeDelivery as string | null,
        areaManagerName: r.AreaManagerName as string | null,
        areaManagerPhone: r.AreaManagerPhone as string | null,
        teamLeaderName: r.TeamLeaderName as string | null,
        teamLeaderPhone: r.TeamLeaderPhone as string | null,
        internetProvider: r.InternetProvider as string | null,
        powerSpec: r.PowerSpec as string | null,
        waterSupply: r.WaterSupply as string | null,
        wasteWater: r.WasteWater as string | null,
        exhaustCFM: r.ExhaustCFM as string | null,
        gasSystem: r.GasSystem as string | null,
        hood: r.Hood as string | null,
        meNote: r.MeNote as string | null,
        menuType: r.MenuType as string | null,
        drinkMenu: r.DrinkMenu as string | null,
        priceList: r.PriceList as string | null,
        cashierSerialNo: r.CashierSerialNo as string | null,
        cashRDNo: r.CashRDNo as string | null,
        revenueDeptBranchCode: r.RevenueDeptBranchCode as string | null,
        vatRegister: r.VatRegister as string | null,
        deliveryPlatforms: (dpMap.get(smId) || []).map((d) => ({
          platformName: d.PlatformName as string,
          isActive: d.IsActive as boolean,
          merchantId: d.MerchantId as string | null,
        })),
        equipment: (eqMap.get(smId) || []).map((e) => ({
          category: e.Category as string,
          itemName: e.ItemName as string,
          quantity: e.Quantity as number,
        })),
        paymentMethods: (pmMap.get(smId) || []).map((p) => ({
          methodName: p.MethodName as string,
          isActive: p.IsActive as boolean,
        })),
        products: (prMap.get(smId) || []).map((p) => ({
          productName: p.ProductName as string,
          isAvailable: p.IsAvailable as boolean,
        })),
      };
    });

    // Last sync: LocationSync from centralized ETL_JobLog (Rocks_PCTH_Data)
    let lastSync: string | null = null;
    try {
      const locSync = await pool.request().query(`
        SELECT TOP 1 CONVERT(VARCHAR(19), FinishedAt, 120) AS lastDate
        FROM [Rocks_PCTH_Data].[dbo].[ETL_JobLog]
        WHERE JobName = 'LocationSync' AND Status = 'OK'
        ORDER BY FinishedAt DESC
      `);
      lastSync = (locSync.recordset[0]?.lastDate as string) ?? null;
    } catch { /* ETL log unavailable */ }

    return NextResponse.json({ ok: true, data: { brands, stores, lastSync } });
  } catch (err) {
    console.error("[api/locations] GET", err);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch locations" },
      { status: 500 },
    );
  }
}
