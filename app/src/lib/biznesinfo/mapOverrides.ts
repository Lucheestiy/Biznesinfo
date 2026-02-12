export interface BiznesinfoMapOverride {
  address?: string;
  lat?: number;
  lng?: number;
}

export const BIZNESINFO_MAP_OVERRIDES: Record<string, BiznesinfoMapOverride> = {
  "msu-23": {
    address: "Минск, Белорусская улица, 17",
    lat: 53.890436,
    lng: 27.563313,
  },
  msu23: {
    address: "Минск, Белорусская улица, 17",
    lat: 53.890436,
    lng: 27.563313,
  },
};
