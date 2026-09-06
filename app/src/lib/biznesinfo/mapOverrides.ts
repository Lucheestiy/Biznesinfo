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
  // Типография «Градиент» — адрес обновлен по актуальному контакту с сайта компании.
  gradient: {
    address: "г. Минск, ул. Асаналиева, 84 к.2",
    lat: 53.8397365,
    lng: 27.5423438,
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
