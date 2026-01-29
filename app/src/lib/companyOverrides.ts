// Персональные настройки для отдельных карточек компаний
// Компании из этого списка защищены от общих изменений шаблона

export interface CompanyOverride {
  // Позиция логотипа: "top" (сверху), "floating" (висящий), "left" (слева от названия), "contacts" (в блоке контактов)
  logoPosition?: "top" | "floating" | "left" | "contacts";
  
  // Сюда можно добавлять другие персональные настройки:
  // headerColor?: string;
  // hideServices?: boolean;
  // customAbout?: string;
  // и т.д.
}

export const COMPANY_OVERRIDES: Record<string, CompanyOverride> = {
  "msu-23": {
    logoPosition: "left",
  },
};

// Хелпер для получения настроек компании
export function getCompanyOverride(sourceId: string): CompanyOverride | null {
  return COMPANY_OVERRIDES[sourceId] || null;
}

// Проверка, является ли компания "особой"
export function isSpecialCompany(sourceId: string): boolean {
  return sourceId in COMPANY_OVERRIDES;
}
