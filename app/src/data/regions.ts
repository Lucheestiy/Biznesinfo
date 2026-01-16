export interface Region {
  name: string;
  slug: string;
  isCity?: boolean;
}

export const regions: Region[] = [
  { name: "Минская область", slug: "minsk-region", isCity: true },
  { name: "Брестская область", slug: "brest", isCity: true },
  { name: "Витебская область", slug: "vitebsk", isCity: true },
  { name: "Гомельская область", slug: "gomel", isCity: true },
  { name: "Гродненская область", slug: "grodno", isCity: true },
  { name: "Могилёвская область", slug: "mogilev", isCity: true },
];

export const regionMapping: Record<string, string[]> = {
  // Города
  "minsk": ["Минск"],
  "brest-city": ["Брест"],
  "vitebsk-city": ["Витебск", "Новополоцк", "Полоцк"],
  "gomel-city": ["Гомель"],
  "grodno-city": ["Гродно"],
  "mogilev-city": ["Могилёв", "Могилев"],

  // Области
  "minsk-region": ["Минская", "Борисов", "Солигорск", "Молодечно", "Жодино", "Слуцк", "Дзержинск"],
  "brest": ["Брестская", "Брест", "Барановичи", "Пинск", "Кобрин", "Береза"],
  "vitebsk": ["Витебская", "Витебск", "Орша", "Новополоцк", "Полоцк", "Глубокое", "Лепель", "Островец"],
  "gomel": ["Гомельская", "Гомель", "Мозырь", "Жлобин", "Светлогорск", "Речица", "Калинковичи"],
  "grodno": ["Гродненская", "Гродно", "Лида", "Слоним", "Волковыск", "Сморгонь", "Новогрудок"],
  "mogilev": ["Могилёвская", "Могилевская", "Могилёв", "Могилев", "Бобруйск", "Горки", "Кричев", "Осиповичи"],
};
