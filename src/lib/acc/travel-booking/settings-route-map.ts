import {
  listReasons,
  upsertReason,
  reorderReasons,
  listAccommodations,
  upsertAccommodation,
  reorderAccommodations,
  listVehicles,
  upsertVehicle,
  reorderVehicles,
  listRentVehicles,
  upsertRentVehicle,
  reorderRentVehicles,
} from "@/lib/acc/travel-booking/settings-service";
import type { Accommodation, RentVehicle, TravelReasonOption, VehicleOption } from "@/features/travel-booking/types";

/**
 * Maps the 4 URL-safe `[kind]` segments used by
 * `/api/request/travel-booking/settings/[kind]` (+ `/reorder`) to the matching
 * list/upsert/reorder functions in `settings-service.ts`.
 */
export const SETTINGS_KIND_ROUTES = {
  reasons: { list: listReasons, upsert: upsertReason, reorder: reorderReasons },
  accommodations: { list: listAccommodations, upsert: upsertAccommodation, reorder: reorderAccommodations },
  vehicles: { list: listVehicles, upsert: upsertVehicle, reorder: reorderVehicles },
  "rent-vehicles": { list: listRentVehicles, upsert: upsertRentVehicle, reorder: reorderRentVehicles },
} satisfies Record<
  string,
  {
    list: (activeOnly?: boolean) => Promise<(TravelReasonOption | Accommodation | VehicleOption | RentVehicle)[]>;
    upsert: (
      // Superset of every kind's payload — reasons/accommodations/rent use requiresCustomReason;
      // vehicles use the needs* flags + places. Each concrete upsert reads only what it needs.
      row: {
        id?: number;
        name: string;
        isActive?: boolean;
        sortOrder?: number;
        requiresCustomReason?: boolean;
        icon?: string | null;
        needsRoomBooking?: boolean;
        needsRentBooking?: boolean;
        needsDepartureLocations?: boolean;
        needsTicketBooking?: boolean;
        needsDepartTime?: boolean;
        needsVehicleRent?: boolean;
        places?: string[];
      },
      userId: number,
    ) => Promise<void>;
    reorder: (orderedIds: number[]) => Promise<void>;
  }
>;

export type SettingsKind = keyof typeof SETTINGS_KIND_ROUTES;

export function isSettingsKind(kind: string): kind is SettingsKind {
  return Object.prototype.hasOwnProperty.call(SETTINGS_KIND_ROUTES, kind);
}
