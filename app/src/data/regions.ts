export interface Region {
  name: string;
  slug: string;
  isCity?: boolean;
}

export const regions: Region[] = [
  // Минск и Минская область
  { name: "Минск", slug: "minsk", isCity: true },
  { name: "Минская область", slug: "minsk-region" },

  // Брест и Брестская область
  { name: "Брест", slug: "brest-city", isCity: true },
  { name: "Брестская область", slug: "brest" },

  // Витебск и Витебская область
  { name: "Витебск", slug: "vitebsk-city", isCity: true },
  { name: "Витебская область", slug: "vitebsk" },

  // Гомель и Гомельская область
  { name: "Гомель", slug: "gomel-city", isCity: true },
  { name: "Гомельская область", slug: "gomel" },

  // Гродно и Гродненская область
  { name: "Гродно", slug: "grodno-city", isCity: true },
  { name: "Гродненская область", slug: "grodno" },

  // Могилёв и Могилёвская область
  { name: "Могилёв", slug: "mogilev-city", isCity: true },
  { name: "Могилёвская область", slug: "mogilev" },
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
