export interface BiznesinfoMapOverride {
  address?: string;
  lat?: number;
  lng?: number;
}

export const BIZNESINFO_MAP_OVERRIDES: Record<string, BiznesinfoMapOverride> = {
  gordorstroy: {
    address: "220053, Минск, ул. Червякова, 25",
    lat: 53.92528,
    lng: 27.549605,
  },
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
  // ООО «ИрИс интерн ГРУПП» — актуальный адрес с официальной страницы контактов компании.
  "biznesinfo-101566": {
    address: "220039, Республика Беларусь, Минск, ул. Воронянского, 7А, офис 802",
  },
};
