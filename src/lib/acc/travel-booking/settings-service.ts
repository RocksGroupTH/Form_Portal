import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import type {
  Accommodation,
  RentVehicle,
  TravelReasonOption,
  VehicleOption,
  VehiclePlace,
} from "@/features/travel-booking/types";

/**
 * CRUD for the 4 AP-17 settings tables (AccTravelReason / AccTravelAccommodation /
 * AccTravelVehicleOption / AccTravelRentVehicle) — all share the same shape
 * `{Id, Name, IsActive, SortOrder, RequiresCustomReason, CreatedBy, CreatedAt, UpdatedAt}`,
 * so a single generic helper (keyed by table name) backs list/upsert/reorder for each.
 * Mirrors the AccVehicle CRUD pattern in `src/lib/acc/settings-service.ts`.
 */

const TABLES = {
  reason: "AccTravelReason",
  accommodation: "AccTravelAccommodation",
  vehicle: "AccTravelVehicleOption",
  rentVehicle: "AccTravelRentVehicle",
} as const;

type TravelSettingsKind = keyof typeof TABLES;

interface TravelSettingsRow {
  id: number;
  name: string;
  isActive: boolean;
  sortOrder: number;
  requiresCustomReason: boolean;
  icon: string | null;
}

function mapRow(x: Record<string, unknown>): TravelSettingsRow {
  return {
    id: x.Id as number,
    name: x.Name as string,
    isActive: !!x.IsActive,
    sortOrder: x.SortOrder as number,
    requiresCustomReason: !!x.RequiresCustomReason,
    icon: (x.Icon as string) ?? null,
  };
}

async function listSettings(
  kind: TravelSettingsKind,
  activeOnly: boolean,
): Promise<TravelSettingsRow[]> {
  const table = TABLES[kind];
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, Name, IsActive, SortOrder, RequiresCustomReason, Icon
    FROM [dbo].[${table}] ${activeOnly ? "WHERE IsActive = 1" : ""} ORDER BY SortOrder, Name
  `);
  return r.recordset.map(mapRow);
}

async function upsertSettings(
  kind: TravelSettingsKind,
  row: {
    id?: number;
    name: string;
    isActive?: boolean;
    sortOrder?: number;
    requiresCustomReason?: boolean;
    icon?: string | null;
  },
  userId: number,
): Promise<void> {
  const table = TABLES[kind];
  await writeBothPools(async (tx) => {
    const req = tx
      .request()
      .input("name", sql.NVarChar, row.name)
      .input("active", sql.Bit, row.isActive === false ? 0 : 1)
      .input("sort", sql.Int, row.sortOrder ?? 0)
      .input("requiresCustom", sql.Bit, row.requiresCustomReason ? 1 : 0)
      .input("icon", sql.NVarChar, row.icon?.trim() || null)
      .input("user", sql.Int, userId || null);
    if (row.id) {
      req.input("id", sql.Int, row.id);
      await req.query(`UPDATE [dbo].[${table}] SET Name=@name, IsActive=@active, SortOrder=@sort,
        RequiresCustomReason=@requiresCustom, Icon=@icon, UpdatedAt=SYSDATETIME() WHERE Id=@id`);
    } else {
      await req.query(`INSERT INTO [dbo].[${table}] (Name,IsActive,SortOrder,RequiresCustomReason,Icon,CreatedBy)
        VALUES (@name,@active,@sort,@requiresCustom,@icon,@user)`);
    }
  });
}

/** Persist a new display order (SortOrder = position in the array). */
async function reorderSettings(
  kind: TravelSettingsKind,
  orderedIds: number[],
): Promise<void> {
  if (!orderedIds.length) return;
  const table = TABLES[kind];
  await writeBothPools(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .request()
        .input("id", sql.Int, orderedIds[i])
        .input("sort", sql.Int, i)
        .query(
          `UPDATE [dbo].[${table}] SET SortOrder=@sort, UpdatedAt=SYSDATETIME() WHERE Id=@id`,
        );
    }
  });
}

/** Flip IsActive for one row of any of the 4 settings tables. */
export async function toggleActive(
  kind: TravelSettingsKind,
  id: number,
  isActive: boolean,
  userId: number,
): Promise<void> {
  const table = TABLES[kind];
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("id", sql.Int, id)
      .input("active", sql.Bit, isActive ? 1 : 0)
      .input("user", sql.Int, userId || null)
      .query(
        `UPDATE [dbo].[${table}] SET IsActive=@active, UpdatedAt=SYSDATETIME() WHERE Id=@id`,
      );
  });
}

/* ---- Reasons (ข้อ5, AccTravelReason) ---- */
export async function listReasons(
  activeOnly = false,
): Promise<TravelReasonOption[]> {
  return listSettings("reason", activeOnly);
}
export async function upsertReason(
  row: {
    id?: number;
    name: string;
    isActive?: boolean;
    sortOrder?: number;
    requiresCustomReason?: boolean;
    icon?: string | null;
  },
  userId: number,
): Promise<void> {
  return upsertSettings("reason", row, userId);
}
export async function reorderReasons(orderedIds: number[]): Promise<void> {
  return reorderSettings("reason", orderedIds);
}

/* ---- Accommodations (ข้อ10, AccTravelAccommodation) ----
 * Specialized (not the generic helper) to carry the NeedsRoomBooking flag that drives
 * the requester form (selecting this accommodation → Admin books the room). */
export interface AccommodationUpsertInput {
  id?: number;
  name: string;
  isActive?: boolean;
  sortOrder?: number;
  icon?: string | null;
  needsRoomBooking?: boolean;
}

export async function listAccommodations(
  activeOnly = false,
): Promise<Accommodation[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, Name, IsActive, SortOrder, RequiresCustomReason, Icon, NeedsRoomBooking
    FROM [dbo].[AccTravelAccommodation]
    ${activeOnly ? "WHERE IsActive = 1" : ""} ORDER BY SortOrder, Name
  `);
  return r.recordset.map((x) => ({
    id: x.Id as number,
    name: x.Name as string,
    isActive: !!x.IsActive,
    sortOrder: x.SortOrder as number,
    requiresCustomReason: !!x.RequiresCustomReason,
    icon: (x.Icon as string) ?? null,
    needsRoomBooking: !!x.NeedsRoomBooking,
  }));
}

export async function upsertAccommodation(
  row: AccommodationUpsertInput,
  userId: number,
): Promise<void> {
  await writeBothPools(async (tx) => {
    const req = tx
      .request()
      .input("name", sql.NVarChar, row.name)
      .input("active", sql.Bit, row.isActive === false ? 0 : 1)
      .input("sort", sql.Int, row.sortOrder ?? 0)
      .input("icon", sql.NVarChar, row.icon?.trim() || null)
      .input("needRoom", sql.Bit, row.needsRoomBooking ? 1 : 0)
      .input("user", sql.Int, userId || null);
    if (row.id) {
      req.input("id", sql.Int, row.id);
      await req.query(`UPDATE [dbo].[AccTravelAccommodation]
        SET Name=@name, IsActive=@active, SortOrder=@sort, Icon=@icon, NeedsRoomBooking=@needRoom,
            UpdatedAt=SYSDATETIME() WHERE Id=@id`);
    } else {
      await req.query(`INSERT INTO [dbo].[AccTravelAccommodation]
        (Name,IsActive,SortOrder,Icon,NeedsRoomBooking,CreatedBy)
        VALUES (@name,@active,@sort,@icon,@needRoom,@user)`);
    }
  });
}
export async function reorderAccommodations(
  orderedIds: number[],
): Promise<void> {
  return reorderSettings("accommodation", orderedIds);
}

/* ---- Vehicles (ข้อ12, AccTravelVehicleOption) ----
 * Specialized (not the generic helper) because a vehicle carries 4 behaviour flags
 * that drive the requester form + a child list of pickable departure places. */
export interface VehicleUpsertInput {
  id?: number;
  name: string;
  isActive?: boolean;
  sortOrder?: number;
  icon?: string | null;
  needsDepartureLocations?: boolean;
  needsTicketBooking?: boolean;
  needsDepartTime?: boolean;
  needsVehicleRent?: boolean;
  /** Full replacement list of place names (in order). `undefined` leaves places untouched. */
  places?: string[];
}

export async function listVehicles(
  activeOnly = false,
): Promise<VehicleOption[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, Name, IsActive, SortOrder, RequiresCustomReason, Icon,
           NeedsDepartureLocations, NeedsTicketBooking, NeedsDepartTime, NeedsVehicleRent
    FROM [dbo].[AccTravelVehicleOption]
    ${activeOnly ? "WHERE IsActive = 1" : ""} ORDER BY SortOrder, Name
  `);
  const vehicles: VehicleOption[] = r.recordset.map((x) => ({
    id: x.Id as number,
    name: x.Name as string,
    isActive: !!x.IsActive,
    sortOrder: x.SortOrder as number,
    requiresCustomReason: !!x.RequiresCustomReason,
    icon: (x.Icon as string) ?? null,
    needsDepartureLocations: !!x.NeedsDepartureLocations,
    needsTicketBooking: !!x.NeedsTicketBooking,
    needsDepartTime: !!x.NeedsDepartTime,
    needsVehicleRent: !!x.NeedsVehicleRent,
    places: [],
  }));
  if (vehicles.length) {
    const pr = await pool.request().query(`
      SELECT Id, VehicleOptionId, Name, SortOrder
      FROM [dbo].[AccTravelVehiclePlace] ORDER BY VehicleOptionId, SortOrder
    `);
    const byVehicle = new Map<number, VehiclePlace[]>();
    for (const p of pr.recordset) {
      const list = byVehicle.get(p.VehicleOptionId as number) ?? [];
      list.push({
        id: p.Id as number,
        name: p.Name as string,
        sortOrder: p.SortOrder as number,
      });
      byVehicle.set(p.VehicleOptionId as number, list);
    }
    for (const v of vehicles) v.places = byVehicle.get(v.id) ?? [];
  }
  return vehicles;
}

export async function upsertVehicle(
  row: VehicleUpsertInput,
  userId: number,
): Promise<void> {
  // Set on the production pass and reused on the UAT one. AccTravelVehiclePlace
  // rows reference this id, so the two databases must agree on it explicitly
  // rather than each trusting its own identity counter.
  let vehicleId = row.id ?? 0;

  await writeBothPools(async (tx) => {
    const isUatPass = !row.id && vehicleId !== 0;
    const req = tx
      .request()
      .input("name", sql.NVarChar, row.name)
      .input("active", sql.Bit, row.isActive === false ? 0 : 1)
      .input("sort", sql.Int, row.sortOrder ?? 0)
      .input("icon", sql.NVarChar, row.icon?.trim() || null)
      .input("needDep", sql.Bit, row.needsDepartureLocations ? 1 : 0)
      .input("needTicket", sql.Bit, row.needsTicketBooking ? 1 : 0)
      .input("needTime", sql.Bit, row.needsDepartTime ? 1 : 0)
      .input("needRent", sql.Bit, row.needsVehicleRent ? 1 : 0)
      .input("user", sql.Int, userId || null);

    if (row.id) {
      req.input("id", sql.Int, row.id);
      await req.query(`UPDATE [dbo].[AccTravelVehicleOption]
        SET Name=@name, IsActive=@active, SortOrder=@sort, Icon=@icon,
            NeedsDepartureLocations=@needDep, NeedsTicketBooking=@needTicket,
            NeedsDepartTime=@needTime, NeedsVehicleRent=@needRent, UpdatedAt=SYSDATETIME()
        WHERE Id=@id`);
    } else if (isUatPass) {
      req.input("id", sql.Int, vehicleId);
      await req.query(`SET IDENTITY_INSERT [dbo].[AccTravelVehicleOption] ON;
        INSERT INTO [dbo].[AccTravelVehicleOption]
        (Id,Name,IsActive,SortOrder,Icon,NeedsDepartureLocations,NeedsTicketBooking,NeedsDepartTime,NeedsVehicleRent,CreatedBy)
        VALUES (@id,@name,@active,@sort,@icon,@needDep,@needTicket,@needTime,@needRent,@user);
        SET IDENTITY_INSERT [dbo].[AccTravelVehicleOption] OFF;`);
    } else {
      const ins = await req.query(`INSERT INTO [dbo].[AccTravelVehicleOption]
        (Name,IsActive,SortOrder,Icon,NeedsDepartureLocations,NeedsTicketBooking,NeedsDepartTime,NeedsVehicleRent,CreatedBy)
        OUTPUT INSERTED.Id
        VALUES (@name,@active,@sort,@icon,@needDep,@needTicket,@needTime,@needRent,@user)`);
      vehicleId = ins.recordset[0].Id as number;
    }

    // Replace the place list when the caller provided one (undefined = leave untouched).
    if (row.places !== undefined && vehicleId) {
      await tx
        .request()
        .input("vid", sql.Int, vehicleId)
        .query(
          `DELETE FROM [dbo].[AccTravelVehiclePlace] WHERE VehicleOptionId=@vid`,
        );
      const places = row.places.map((s) => s.trim()).filter(Boolean);
      for (let i = 0; i < places.length; i++) {
        await tx
          .request()
          .input("vid", sql.Int, vehicleId)
          .input("pname", sql.NVarChar, places[i])
          .input("psort", sql.Int, i)
          .query(
            `INSERT INTO [dbo].[AccTravelVehiclePlace] (VehicleOptionId,Name,SortOrder) VALUES (@vid,@pname,@psort)`,
          );
      }
    }
  });
}
export async function reorderVehicles(orderedIds: number[]): Promise<void> {
  return reorderSettings("vehicle", orderedIds);
}

/* ---- Rent vehicles (ข้อ15, AccTravelRentVehicle) ----
 * Specialized (not the generic helper) to carry the NeedsRentBooking flag that drives
 * the requester form (selecting this rental → Admin arranges the rental). */
export interface RentVehicleUpsertInput {
  id?: number;
  name: string;
  isActive?: boolean;
  sortOrder?: number;
  icon?: string | null;
  needsRentBooking?: boolean;
}

export async function listRentVehicles(
  activeOnly = false,
): Promise<RentVehicle[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, Name, IsActive, SortOrder, RequiresCustomReason, Icon, NeedsRentBooking
    FROM [dbo].[AccTravelRentVehicle]
    ${activeOnly ? "WHERE IsActive = 1" : ""} ORDER BY SortOrder, Name
  `);
  return r.recordset.map((x) => ({
    id: x.Id as number,
    name: x.Name as string,
    isActive: !!x.IsActive,
    sortOrder: x.SortOrder as number,
    requiresCustomReason: !!x.RequiresCustomReason,
    icon: (x.Icon as string) ?? null,
    needsRentBooking: !!x.NeedsRentBooking,
  }));
}

export async function upsertRentVehicle(
  row: RentVehicleUpsertInput,
  userId: number,
): Promise<void> {
  await writeBothPools(async (tx) => {
    const req = tx
      .request()
      .input("name", sql.NVarChar, row.name)
      .input("active", sql.Bit, row.isActive === false ? 0 : 1)
      .input("sort", sql.Int, row.sortOrder ?? 0)
      .input("icon", sql.NVarChar, row.icon?.trim() || null)
      .input("needRent", sql.Bit, row.needsRentBooking ? 1 : 0)
      .input("user", sql.Int, userId || null);
    if (row.id) {
      req.input("id", sql.Int, row.id);
      await req.query(`UPDATE [dbo].[AccTravelRentVehicle]
        SET Name=@name, IsActive=@active, SortOrder=@sort, Icon=@icon, NeedsRentBooking=@needRent,
            UpdatedAt=SYSDATETIME() WHERE Id=@id`);
    } else {
      await req.query(`INSERT INTO [dbo].[AccTravelRentVehicle]
        (Name,IsActive,SortOrder,Icon,NeedsRentBooking,CreatedBy)
        VALUES (@name,@active,@sort,@icon,@needRent,@user)`);
    }
  });
}
export async function reorderRentVehicles(orderedIds: number[]): Promise<void> {
  return reorderSettings("rentVehicle", orderedIds);
}
