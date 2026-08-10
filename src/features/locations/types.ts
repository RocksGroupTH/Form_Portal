/* Location feature types — mirrors Rocks_Codex schema (view-only) */

export interface Brand {
  id: number;
  name: string;
  code: string;
  logo: string | null;
  isActive: boolean;
}

export interface StoreDeliveryPlatform {
  platformName: string;
  isActive: boolean;
  merchantId: string | null;
}

export interface StoreEquipment {
  category: string;
  itemName: string;
  quantity: number;
}

export interface StorePaymentMethod {
  methodName: string;
  isActive: boolean;
}

export interface StoreProduct {
  productName: string;
  isAvailable: boolean;
}

export interface StoreRow {
  id: number;
  locationId: number | null;
  locationName: string;
  locationCode: string;
  locationBrandId: number | null;
  locationType: string | null;
  brandCode: string | null;
  shopCode: string;
  storeName: string | null;
  storeNameEn: string | null;
  storeNameTh: string | null;
  storeFormat: string | null;
  storeType: string | null;
  storeTypeMKT: string | null;
  company: string | null;
  region: string | null;
  province: string | null;
  district: string | null;
  shopClass: string | null;
  floor: string | null;
  roomNo: string | null;
  zone: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  long: number | null;
  storeSize: number | null;
  stockSize: number | null;
  status: string | null;
  openingDate: string | null;
  seatCount: number | null;
  year: number | null;
  openTimeWeekday: string | null;
  closeTimeWeekday: string | null;
  openTimeWeekend: string | null;
  closeTimeWeekend: string | null;
  openTimeDelivery: string | null;
  closeTimeDelivery: string | null;
  areaManagerName: string | null;
  areaManagerPhone: string | null;
  teamLeaderName: string | null;
  teamLeaderPhone: string | null;
  // Facilities / M&E
  internetProvider: string | null;
  powerSpec: string | null;
  waterSupply: string | null;
  wasteWater: string | null;
  exhaustCFM: string | null;
  gasSystem: string | null;
  hood: string | null;
  meNote: string | null;
  // Menu
  menuType: string | null;
  drinkMenu: string | null;
  priceList: string | null;
  // Tax
  cashierSerialNo: string | null;
  cashRDNo: string | null;
  revenueDeptBranchCode: string | null;
  vatRegister: string | null;
  // Child tables
  deliveryPlatforms: StoreDeliveryPlatform[];
  equipment: StoreEquipment[];
  paymentMethods: StorePaymentMethod[];
  products: StoreProduct[];
}
