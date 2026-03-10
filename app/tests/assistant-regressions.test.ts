import assert from "node:assert/strict";
import test from "node:test";

import { __assistantRouteTestHooks } from "../src/app/api/ai/request/route";
import { shouldApplyFinalAssistantText } from "../src/lib/ai/streamFinalization";

function makeVendorCandidate(
  overrides: Partial<{
    id: string;
    name: string;
    address: string;
    city: string;
    region: string;
    description: string;
    primary_rubric_name: string | null;
    primary_category_name: string | null;
    _distanceMeters: number | null;
  }> = {},
) {
  return {
    id: overrides.id || "candidate-1",
    source: "biznesinfo" as const,
    unp: "",
    name: overrides.name || "Тестовая компания",
    address: overrides.address || "Минск",
    city: overrides.city || "Минск",
    region: overrides.region || "minsk",
    work_hours: {},
    phones_ext: [],
    phones: ["+375 (29) 000 00 00"],
    emails: [],
    websites: [],
    description: overrides.description || "",
    about: "",
    logo_url: "",
    primary_category_slug: null,
    primary_category_name: overrides.primary_category_name || null,
    primary_rubric_slug: null,
    primary_rubric_name: overrides.primary_rubric_name || null,
    _distanceMeters: overrides._distanceMeters,
  };
}

test("stream delta keeps boundary spaces between chunks", () => {
  const out = ["Могу", " помочь", " подобрать", " поставщиков."].map(__assistantRouteTestHooks.prepareStreamingDeltaChunk).join("");
  assert.equal(out, "Могу помочь подобрать поставщиков.");
  assert.equal(__assistantRouteTestHooks.prepareStreamingDeltaChunk(" где"), " где");
  assert.equal(__assistantRouteTestHooks.prepareStreamingDeltaChunk("купить "), "купить ");
});

test("duplicate clarifying question blocks are collapsed to one block", () => {
  const source = [
    "Для того чтобы помочь Вам, мне нужно уточнить несколько вопросов:",
    "1. Покупка нужна оптом или в розницу?",
    "2. Какой город/регион приоритетный?",
    "",
    "Для того чтобы помочь Вам, мне нужно уточнить несколько вопросов:",
    "1. Покупка нужна оптом или в розницу?",
    "2. Какой город/регион приоритетный?",
    "",
    "После ответа на эти вопросы сразу продолжу подбор.",
  ].join("\n");

  const result = __assistantRouteTestHooks.removeDuplicateClarifyingQuestionBlocks(source);
  const introMatches = result.match(/Для того чтобы помочь Вам, мне нужно уточнить несколько вопросов:/g) || [];
  assert.equal(introMatches.length, 1);
  assert.match(result, /После ответа на эти вопросы сразу продолжу подбор\./);
});

test("commodity slot-state marks filled milk sourcing slots when user provided key params", () => {
  const state = __assistantRouteTestHooks.buildCommoditySourcingSlotState({
    normalizedSeed: "где купить 200 тон молока минск пастериализованное 3.2% налив завтра еженедельно",
    hasKnownLocation: true,
    hasSinglePieceRetailIntent: false,
    history: [],
    commodityTag: "milk",
  });

  assert.equal(state.location, "filled");
  assert.equal(state.wholesaleRetail, "filled");
  assert.equal(state.quantity, "filled");
  assert.equal(state.deadline, "filled");
  assert.equal(state.regularity, "filled");
  assert.equal(state.milk?.type, "filled");
  assert.equal(state.milk?.fatness, "filled");
  assert.equal(state.milk?.shipment, "filled");
});

test("commodity slot-state tracks asked_pending slots to avoid duplicate repeated questions", () => {
  const state = __assistantRouteTestHooks.buildCommoditySourcingSlotState({
    normalizedSeed: "где купить молоко минск",
    hasKnownLocation: true,
    hasSinglePieceRetailIntent: false,
    history: [
      {
        role: "assistant",
        content:
          "Для того чтобы помочь Вам, мне нужно уточнить несколько вопросов:\n1. Покупка нужна оптом или в розницу?\n2. Уточните параметры молока: тип молока, жирность, формат отгрузки.\n3. Подтвердите условия сделки: объем (минимальная партия), срок первой отгрузки, регулярность поставок.",
      },
    ],
    commodityTag: "milk",
  });

  assert.equal(state.wholesaleRetail, "asked_pending");
  assert.equal(state.quantity, "asked_pending");
  assert.equal(state.deadline, "asked_pending");
  assert.equal(state.regularity, "asked_pending");
  assert.equal(state.milk?.type, "asked_pending");
  assert.equal(state.milk?.fatness, "asked_pending");
  assert.equal(state.milk?.shipment, "asked_pending");
});

test("metal rolling clarification asks concrete product instead of generic priority", () => {
  const result = __assistantRouteTestHooks.buildSourcingClarifyingQuestionsReply({
    message: "Розница Минск",
    history: [{ role: "user", content: "металл розница" }],
    locationHint: "Минск",
    contextSeed: "металл розница",
  });

  assert.match(result, /Что именно нужно купить из металлопроката/u);
  assert.doesNotMatch(result, /приоритет по выбору/u);
});

test("broad candle query forces initial clarifying questions before shortlist", () => {
  const shouldForce = __assistantRouteTestHooks.shouldForceInitialProductClarificationBeforeShortlist({
    message: "где купить свечи",
    history: [],
    replyText: [
      "Вот варианты из каталога, где можно купить свечи:",
      "1. Мануфактура Мир свечи ООО — /company/mirsvechi",
      "2. МосКомп ООО — /company/moskcomp",
    ].join("\n"),
    vendorLookupContext: null,
  });

  assert.equal(shouldForce, true);
});

test("candle query with city and wholesale does not force initial clarifiers", () => {
  const shouldForce = __assistantRouteTestHooks.shouldForceInitialProductClarificationBeforeShortlist({
    message: "где купить свечи оптом Минск",
    history: [],
    replyText: [
      "Подобрал компании из каталога по вашему запросу:",
      "1. Мануфактура Мир свечи ООО — /company/mirsvechi",
      "2. МосКомп ООО — /company/moskcomp",
    ].join("\n"),
    vendorLookupContext: null,
  });

  assert.equal(shouldForce, false);
});

test("done payload does not overwrite meaningful stream with unrelated fallback shortlist", () => {
  const streamedText =
    "Отлично, фиксирую Минск и формат для коллег. Уточните, пожалуйста, какой бюджет и формат встречи важнее: кофе-брейк или ужин?";
  const finalFallbackText =
    "Подобрал компании из каталога по вашему запросу:\n1. Институт ... /company/x\n2. Центр ... /company/y";

  const shouldApply = shouldApplyFinalAssistantText({
    streamedText,
    finalText: finalFallbackText,
    reasonCodes: ["missing_cards_rewritten"],
  });

  assert.equal(shouldApply, false);
});

test("done payload can apply minor sanitized final text", () => {
  const streamedText =
    "Чтобы помочь точнее, уточните, пожалуйста:\n1. Какой город/район?\n2. Какой формат размещения нужен?";
  const finalSanitizedText =
    "Чтобы помочь точнее, уточните, пожалуйста:\n1. Какой город/район?\n2. Какой формат размещения нужен?\n";

  const shouldApply = shouldApplyFinalAssistantText({
    streamedText,
    finalText: finalSanitizedText,
    reasonCodes: [],
  });

  assert.equal(shouldApply, true);
});

test("done payload applies clarifying final text over streamed shortlist", () => {
  const streamedText = [
    "Подбор компаний по текущим данным каталога:",
    "1. Общежитие Мозырского монтажного управления — /company/ommu",
    "(Гостиницы, отели; Мозырь)",
  ].join("\n");
  const finalClarifyingText = [
    "Для того чтобы помочь Вам, мне нужно уточнить несколько вопросов:",
    "1. В каком городе/регионе ищете?",
    "2. Вам подобрать кафе, рестораны или оба варианта?",
    "3. Что важнее: кухня, атмосфера или семейный формат?",
  ].join("\n");

  const shouldApply = shouldApplyFinalAssistantText({
    streamedText,
    finalText: finalClarifyingText,
    reasonCodes: ["domain_leak_filtered"],
  });

  assert.equal(shouldApply, true);
});

test("done payload does not overwrite complete stream with template block", () => {
  const streamedText =
    "Понял задачу по ремонту кофемашины в Минске. Уточните модель и тип поломки, после ответа сразу подберу релевантные карточки компаний /company.";
  const finalTemplateText = [
    "Тема: Срочный ремонт кофемашины",
    "Текст: Нужен срочный ремонт кофемашины в Минске.",
    "",
    "Сообщение для мессенджера:",
    "Здравствуйте! Нужен срочный ремонт кофемашины в Минске. Модель: [укажите], проблема: [укажите].",
  ].join("\n");

  const shouldApply = shouldApplyFinalAssistantText({
    streamedText,
    finalText: finalTemplateText,
    reasonCodes: [],
  });

  assert.equal(shouldApply, false);
});

test("done payload can apply template when stream is also template", () => {
  const streamedText = [
    "Тема: Запрос по ремонту кофемашины",
    "Текст: Нужен ремонт кофемашины в Минске.",
    "Сообщение для мессенджера: Здравствуйте! Нужен ремонт кофемашины.",
  ].join("\n");
  const finalTemplateText = [
    "Тема: Запрос по ремонту кофемашины",
    "Текст: Нужен ремонт кофемашины в Минске, оплата по безналу.",
    "Сообщение для мессенджера: Здравствуйте! Нужен ремонт кофемашины в Минске.",
  ].join("\n");

  const shouldApply = shouldApplyFinalAssistantText({
    streamedText,
    finalText: finalTemplateText,
    reasonCodes: [],
  });

  assert.equal(shouldApply, true);
});

test("colloquial greeting uses capabilities reply without sourcing checklist", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("че как") || "";
  assert.match(result, /Здравствуйте! Я ваш личный помощник Лориэн\./u);
  assert.match(result, /Подберу релевантные рубрики на портале/u);
  assert.match(result, /коммерческое предложение\/заявку/u);
  assert.doesNotMatch(result, /важные\s+условия/u);
  assert.doesNotMatch(result, /срок,\s*бюджет,\s*объ[её]м/u);
});

test("capabilities follow-up uses fixed competency boundary reply", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("что еще умеешь делать") || "";
  assert.equal(
    result,
    "В моей компетенции только то, о чем я сказал. Но со временем список моих услуг может расти",
  );
});

test("rubric top-3 ranking prefers fuller company cards", () => {
  const minimal = makeVendorCandidate({
    id: "minimal-company",
    name: "Минимальная карточка",
    address: "",
    city: "",
    region: "",
    description: "",
    primary_category_name: null,
    primary_rubric_name: null,
  });
  minimal.about = "";
  minimal.phones = [];
  minimal.phones_ext = [];
  minimal.emails = [];
  minimal.websites = [];
  minimal.logo_url = "";

  const medium = makeVendorCandidate({
    id: "medium-company",
    name: "Средняя карточка",
    description: "Поставка оборудования и расходных материалов.",
    primary_category_name: "Торговля",
    primary_rubric_name: "Оборудование и материалы по уборке помещений",
  });
  medium.about = "Работаем по Беларуси. Подбираем решения под B2B-клиентов.";
  medium.phones = ["+375 (29) 111 11 11"];
  medium.websites = ["https://medium.example"];

  const fullest = makeVendorCandidate({
    id: "fullest-company",
    name: "Максимально заполненная карточка",
    address: "Минск, ул. Тестовая, 1",
    city: "Минск",
    region: "Минская область",
    description: "Комплексные поставки и сервис для клининга, промышленности и HoReCa.",
    primary_category_name: "Торговля",
    primary_rubric_name: "Оборудование и материалы по уборке помещений",
  });
  fullest.about =
    "О компании: поставки, монтаж, сервис. Продукция и услуги: оборудование, расходники, химия, обучение персонала.";
  fullest.phones = ["+375 (29) 222 22 22", "+375 (17) 333 33 33"];
  fullest.phones_ext = [{ number: "+375 (44) 555 55 55", note: "Отдел продаж" }];
  fullest.emails = ["sales@fullest.example"];
  fullest.websites = ["https://fullest.example", "https://catalog.fullest.example"];
  fullest.logo_url = "https://fullest.example/logo.png";

  const rows = __assistantRouteTestHooks.buildRubricTopCompanyRows([minimal, medium, fullest], 3);
  assert.equal(rows.length, 3);
  assert.match(rows[0] || "", /fullest-company/u);
  assert.match(rows[1] || "", /medium-company/u);
  assert.match(rows[2] || "", /minimal-company/u);

  const scoreMinimal = __assistantRouteTestHooks.scoreCompanyForRubricTop(minimal);
  const scoreFullest = __assistantRouteTestHooks.scoreCompanyForRubricTop(fullest);
  assert.ok(scoreFullest.score > scoreMinimal.score);
  assert.ok(scoreFullest.filledFields > scoreMinimal.filledFields);
  assert.ok(scoreFullest.phoneCount > scoreMinimal.phoneCount);
  assert.ok(scoreFullest.anchorLinks > scoreMinimal.anchorLinks);
  assert.ok(scoreFullest.keywordCount > scoreMinimal.keywordCount);
});

test("bare action message does not trigger domain-specific dining clarification", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Дай") || "";
  assert.match(result, /Уточните, что именно нужно найти/u);
  assert.doesNotMatch(result, /где\s+поесть/u);
  assert.doesNotMatch(result, /кафе,\s*рестораны/u);
  assert.doesNotMatch(result, /на\s+сколько\s+человек/u);
});

test("retail bread hard reply includes top-3 company card links after rubric link", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply(
    "Где купить буханку хлеба",
    [],
    [
      "1. Магазин Альфа: /company/alfa",
      "2. Магазин Бета: /company/beta",
      "3. Магазин Гамма: /company/gamma",
    ],
  ) || "";

  assert.match(result, /Открыть карточки с фильтром:\s*\/search\?/u);
  assert.match(result, /Первые\s+релевантные\s+карточки/u);
  assert.match(result, /\/company\/alfa/u);
  assert.match(result, /\/company\/beta/u);
  assert.match(result, /\/company\/gamma/u);
});

test("girls preference intent returns portal-first company selection flow", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("что подарить девушке в Минске") || "";
  assert.match(result, /Подберу карточки компаний/u);
  assert.match(result, /biznesinfo\.by/u);
  assert.match(result, /\/search\?/u);
  assert.doesNotMatch(result, /Можно смотреть шире/u);
});

test("generic lifestyle advice leak is detected for girls intent", () => {
  const leakReply = [
    "Если хотите, помогу точнее — например:",
    "1. Для общения/знакомства",
    "2. Для выбора подарка",
    "3. Для жены/девушки/коллеги (разные форматы)",
    "",
    "Коротко и универсально: чаще всего ценят внимание, уважение, заботу, искренность и надежность.",
  ].join("\n");

  const isLeak = __assistantRouteTestHooks.looksLikeGirlsLifestyleGenericAdviceReply(leakReply);
  assert.equal(isLeak, true);
});

test("stylist intent is redirected to where-to-buy flow on portal", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("что надеть на 8 марта в Минске") || "";
  assert.match(result, /Я не стилист/u);
  assert.match(result, /где купить товары/u);
  assert.match(result, /\/search\?/u);
  assert.doesNotMatch(result, /соберу варианты образов/u);
});

test("hairdresser intent is redirected to salon selection flow on portal", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("какую прическу сделать на 8 марта в Минске") || "";
  assert.match(result, /Я не парикмахер/u);
  assert.match(result, /(парикмахерск|салон\s+красот|барбершоп)/u);
  assert.match(result, /\/search\?/u);
  assert.doesNotMatch(result, /Я не стилист/u);
});

test("hairdresser intent is redirected for plain phrase without occasion context", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Какую прическу сделать") || "";
  assert.match(result, /Я не парикмахер/u);
  assert.match(result, /(парикмахерск|салон\s+красот|барбершоп)/u);
  assert.doesNotMatch(result, /Я не стилист/u);
});

test("hairdresser intent is recognized for phrase 'постричься'", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Хочу постричься") || "";
  assert.doesNotMatch(result, /Я не парикмахер/u);
  assert.match(result, /Сразу направляю в профильные рубрики каталога/u);
  assert.match(result, /(парикмахерск|салон\s+красот|барбершоп)/u);
  assert.match(result, /поисков[а-я]*\s+строк/u);
  assert.doesNotMatch(result, /Как хотите постричься/u);
  assert.doesNotMatch(result, /Я не стилист/u);
});

test("dining request is not misclassified as hairdresser intent", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Где вкусно покушать") || "";
  assert.doesNotMatch(result, /Я не парикмахер/u);
});

test("dining intent is hard-routed to rubric navigation with self-filter guidance", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Где можно поесть") || "";
  assert.match(result, /Я\s+подобрал\s+вам\s+релевантные\s+рубрики/u);
  assert.match(result, /\/catalog\/turizm-otdyh-dosug\/restorany/u);
  assert.match(result, /используйте\s+фильтр:\s*поисковую\s+строку/u);
  assert.doesNotMatch(result, /\/company\//u);
  assert.doesNotMatch(result, /Для того чтобы помочь Вам, мне нужно уточнить/u);
});

test("dining slang phrase is recognized as venue intent", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Где можно пожевать") || "";
  assert.match(result, /\/catalog\/turizm-otdyh-dosug\/kafe/u);
  assert.match(result, /\/catalog\/turizm-otdyh-dosug\/kafe-bary-restorany/u);
  assert.doesNotMatch(result, /\/company\//u);
  assert.doesNotMatch(result, /Для того чтобы помочь Вам, мне нужно уточнить/u);
});

test("dining phrase 'где вкусно готовят' uses strict rubric structure", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Где вкусно готовят") || "";
  assert.match(result, /Я\s+подобрал\s+вам\s+релевантные\s+рубрики/u);
  assert.match(result, /Рестораны:\s*\/catalog\/turizm-otdyh-dosug\/restorany/u);
  assert.match(result, /Кафе:\s*\/catalog\/turizm-otdyh-dosug\/kafe/u);
  assert.match(result, /используйте\s+фильтр:\s*поисковую\s+строку/u);
  assert.doesNotMatch(result, /Понял\s+запрос/u);
  assert.doesNotMatch(result, /Если\s+нужно,\s*следующим\s+сообщением/u);
});

test("dining slang follow-up with location keeps venue clarification flow", () => {
  const result = __assistantRouteTestHooks.buildSourcingClarifyingQuestionsReply({
    message: "Весь Минск",
    history: [{ role: "user", content: "Где можно пожевать" }],
  });
  assert.match(result, /Город\/регион фиксирую как:\s*Минск/u);
  assert.match(result, /Вам подобрать кафе, рестораны или оба варианта/u);
  assert.doesNotMatch(result, /товар или услугу/u);
  assert.doesNotMatch(result, /Покупка нужна оптом или в розницу/u);
});

test("dining direct rubric reply keeps detected city context", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Подскажи лучшие рестораны города Минска") || "";
  assert.match(result, /Я\s+подобрал\s+вам\s+релевантные\s+рубрики/u);
  assert.match(result, /\/catalog\/turizm-otdyh-dosug\/restorany/u);
  assert.match(result, /используйте\s+фильтр:\s*поисковую\s+строку/u);
  assert.doesNotMatch(result, /В каком городе\/регионе ищете/u);
  assert.doesNotMatch(result, /Уточните район или ориентир/u);
});

test("dining direct rubric reply does not ask clarifying questions for metro landmark query", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply(
    "Мне нужно кафе в Минске в районе метро Фрунзенская",
  ) || "";
  assert.match(result, /\/catalog\/turizm-otdyh-dosug\/kafe/u);
  assert.match(result, /Я\s+подобрал\s+вам\s+релевантные\s+рубрики/u);
  assert.match(result, /используйте\s+фильтр:\s*поисковую\s+строку/u);
  assert.doesNotMatch(result, /Уточните район или ориентир/u);
  assert.doesNotMatch(result, /В каком городе\/регионе ищете/u);
  assert.doesNotMatch(result, /Для того чтобы помочь Вам, мне нужно уточнить/u);
});

test("dining follow-up stays in rubric navigation flow without repeated clarifiers", () => {
  const history = [
    { role: "user", content: "Подскажи лучшие рестораны города Минска" },
    {
      role: "assistant",
      content:
        "Для того чтобы помочь Вам, мне нужно уточнить несколько вопросов:\n1. Вижу локацию: Минск. Уточните район или ориентир.\n2. Что для Вас значит «лучшие»: кухня, сервис, атмосфера или семейный формат?",
    },
  ];
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Ресторан, атмосфера", history) || "";
  assert.match(result, /\/catalog\/turizm-otdyh-dosug\/restorany/u);
  assert.match(result, /используйте\s+фильтр:\s*поисковую\s+строку/u);
  assert.doesNotMatch(result, /В каком городе\/регионе ищете/u);
  assert.doesNotMatch(result, /Для того чтобы помочь Вам, мне нужно уточнить/u);
  assert.doesNotMatch(result, /Вам подобрать кафе, рестораны или оба варианта/u);
});

test("dining nearby fish request with typo stays in venue flow", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Где поблизости можно поесть даренную рыбу") || "";
  assert.match(result, /\/catalog\/turizm-otdyh-dosug\/restorany/u);
  assert.match(result, /используйте\s+фильтр:\s*поисковую\s+строку/u);
  assert.doesNotMatch(result, /Покупка нужна оптом или в розницу/u);
  assert.doesNotMatch(result, /объем\/фасовка/u);
  assert.doesNotMatch(result, /Для того чтобы помочь Вам, мне нужно уточнить/u);
});

test("sourcing clarifier avoids wholesale questions for nearby dining fish intent", () => {
  const result = __assistantRouteTestHooks.buildSourcingClarifyingQuestionsReply({
    message: "Где поблизости можно поесть даренную рыбу",
    history: [],
  });
  assert.match(result, /Вам подобрать кафе, рестораны или оба варианта/u);
  assert.match(result, /В каком городе\/регионе ищете варианты/u);
  assert.doesNotMatch(result, /Покупка нужна оптом или в розницу/u);
  assert.doesNotMatch(result, /объем\/фасовка/u);
});

test("dining fish typo query stays in venue clarifier flow and does not ask fish commodity params", () => {
  const result = __assistantRouteTestHooks.buildSourcingClarifyingQuestionsReply({
    message: "Где поблизости можно поесть даренную рыбу в Минске",
    history: [],
  });

  assert.match(result, /Вам подобрать кафе, рестораны или оба варианта/u);
  assert.match(result, /Город\/регион фиксирую как:\s*Минск/u);
  assert.doesNotMatch(result, /Покупка нужна оптом или в розницу/u);
  assert.doesNotMatch(result, /Какой вид рыбы нужен/u);
});

test("accommodation sleep request is hard-routed without budget question", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Где в Минске можно выспаться") || "";
  assert.match(result, /Какой формат размещения нужен/u);
  assert.match(result, /На сколько ночей нужен вариант/u);
  assert.doesNotMatch(result, /бюджет/u);
  assert.doesNotMatch(result, /цена/u);
});

test("accommodation domain fallback terms are injected for sleep intent", () => {
  const domainTag = __assistantRouteTestHooks.detectSourcingDomainTag("Где в Минске можно выспаться");
  assert.equal(domainTag, "accommodation");

  const fallbackTerms = __assistantRouteTestHooks.fallbackDomainSearchTerms(domainTag);
  assert.ok(fallbackTerms.includes("гостиницы"));
  assert.ok(fallbackTerms.includes("проживание"));
  assert.ok(fallbackTerms.includes("ночлег"));
});

test("accommodation ranking keeps hotel candidate and rejects non-hospitality distractor", () => {
  const hotel = makeVendorCandidate({
    id: "hotel-1",
    name: "Гостиница Центральная",
    primary_rubric_name: "Гостиницы, отели",
    description: "Гостиница в Минске, размещение и проживание",
  });
  const distractor = makeVendorCandidate({
    id: "light-1",
    name: "Белсветимпорт",
    primary_rubric_name: "Осветительное оборудование",
    description: "Светотехника и светильники в Минске",
  });

  const ranked = __assistantRouteTestHooks.filterAndRankVendorCandidates({
    companies: [distractor, hotel],
    searchTerms: ["минск"],
    region: null,
    city: "Минск",
    limit: 5,
    sourceText: "Где в Минске можно выспаться",
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, "hotel-1");
  assert.equal(__assistantRouteTestHooks.isAccommodationCandidate(hotel), true);
  assert.equal(__assistantRouteTestHooks.isAccommodationCandidate(distractor), false);
});

test("link/card-request detector catches candidate-list refusal phrasing", () => {
  const refusal = [
    "Супер, подбираю 🙌",
    "Но сейчас у меня нет загруженного списка карточек заведений из biznesinfo.by поэтому не могу честно назвать конкретные места, чтобы не выдумывать.",
    "Пришлите результаты поиска/кандидатов из каталога по Каменной Горке.",
  ].join("\n");

  assert.equal(__assistantRouteTestHooks.assistantAsksUserForLink(refusal), true);
  assert.equal(__assistantRouteTestHooks.looksLikeMissingCardsInMessageRefusal(refusal), true);
});

test("link/card-request detector catches infinitive send-links phrasing", () => {
  const refusal = [
    "Формат, который я сразу верну:",
    "1. Название + формат",
    "2. Почему подходит (1 строка)",
    "3. Ссылка /company/",
    "",
    "Если удобно, можете просто отправить 5-15 ссылок карточек — я отсортирую и выберу лучшие.",
  ].join("\n");

  assert.equal(__assistantRouteTestHooks.assistantAsksUserForLink(refusal), true);
});

test("post-process rewrites candidate-list refusal into autonomous shortlist", () => {
  const candidate = makeVendorCandidate({
    id: "food-quick-1",
    name: "Кофейня Экспресс",
    primary_rubric_name: "Кафе, бары, рестораны",
    description: "Быстрый перекус, кофе с собой, Минск",
  });

  const result = __assistantRouteTestHooks.postProcessAssistantReply({
    replyText: [
      "Супер, подбираю 🙌",
      "Но сейчас у меня нет загруженного списка карточек заведений из biznesinfo.by поэтому не могу честно назвать конкретные места, чтобы не выдумывать.",
      "Пришлите результаты поиска/кандидатов из каталога по Каменной Горке, и я сразу сделаю короткий рейтинг.",
    ].join("\n"),
    message: "Подбирай",
    history: [
      { role: "user", content: "Где можно что нибудь пожевать в Минске" },
      { role: "assistant", content: "Уточните, пожалуйста, район Минска и формат." },
      { role: "user", content: "Каменная горка" },
      { role: "assistant", content: "Что Вам ближе: перекусить, кафе или доставка?" },
      { role: "user", content: "Перекусить" },
    ],
    mode: { templateRequested: false, rankingRequested: false, checklistRequested: false },
    rubricHintItems: [],
    vendorCandidates: [candidate],
    vendorLookupContext: {
      shouldLookup: true,
      searchText: "перекусить каменная горка минск",
      region: null,
      city: "Минск",
      derivedFromHistory: true,
      sourceMessage: "Где можно что нибудь пожевать в Минске",
      excludeTerms: [],
    },
  });

  assert.match(result, /ссылки от Вас не требуются/u);
  assert.match(result, /\/company\//u);
  assert.doesNotMatch(result, /пришлит\p{L}*[^.\n]{0,120}(?:результат\p{L}*\s+поиск|кандидат\p{L}*\s+поиск|списк\p{L}*[^.\n]{0,40}карточк\p{L}*)/iu);
});

test("post-process appends /company links when reply lists companies without card paths", () => {
  const candidates = [
    makeVendorCandidate({
      id: "dubai-orekhi",
      name: "Дубай орехи и сухофрукты ООО",
      primary_rubric_name: "Продукты питания",
      description: "Семечки, орехи и сухофрукты. Розница/опт.",
    }),
    makeVendorCandidate({
      id: "smakata-by",
      name: "Интернет-магазин smakata.by ООО",
      primary_rubric_name: "Продукты питания",
      description: "Снеки и бакалея, в т.ч. семечки.",
    }),
    makeVendorCandidate({
      id: "onega-podo",
      name: "ОНЕГА ПОДО",
      primary_rubric_name: "Производство снеков",
      description: "Производитель снеков и семечек.",
    }),
  ];

  const result = __assistantRouteTestHooks.postProcessAssistantReply({
    replyText: [
      "По вашему запросу подойдут такие компании из каталога biznesinfo.by:",
      "1. Дубай орехи и сухофрукты ООО — в карточке указаны семечки.",
      "2. Интернет-магазин smakata.by ООО — в ассортименте также есть семечки.",
      "3. ОНЕГА ПОДО — производитель снеков и семечек.",
    ].join("\n"),
    message: "дай 3 компании по семечкам в Минске",
    history: [{ role: "user", content: "где купить семечки в Минске" }],
    mode: { templateRequested: false, rankingRequested: false, checklistRequested: false },
    rubricHintItems: [],
    vendorCandidates: candidates,
    vendorLookupContext: {
      shouldLookup: true,
      searchText: "семечки минск",
      region: null,
      city: "Минск",
      derivedFromHistory: true,
      sourceMessage: "где купить семечки в Минске",
      excludeTerms: [],
    },
  });

  assert.match(result, /\/company\/dubai-orekhi/u);
  assert.match(result, /\/company\/smakata-by/u);
  assert.match(result, /Конкретные компании из текущего списка|Ссылки на карточки компаний/u);
});

test("normalize shortlist wording removes standalone budget question line", () => {
  const source = [
    "Для того чтобы помочь Вам, мне нужно уточнить несколько вопросов:",
    "1. Какой формат хотите?",
    "2. В каком районе Минска Вам удобнее?",
    "3. Бюджет на человека примерно какой?",
    "После ответа подберу варианты.",
  ].join("\n");

  const result = __assistantRouteTestHooks.normalizeShortlistWording(source);
  assert.doesNotMatch(result, /бюджет/u);
  assert.match(result, /Какой формат хотите/u);
  assert.match(result, /В каком районе Минска/u);
});

test("dining distractor leak is detected for sports center shortlist", () => {
  const leakReply = [
    "Понял Вас: Минск, центр, жареная рыба.",
    "Сейчас в доступных кандидатах из каталога есть только 1 релевантная карточка, и это не ресторан, а спортивно-оздоровительный центр:",
    "1. Московский ФОЦ ГУ — /company/mfoc",
    "Почему в выдаче: в карточке указан формат услуг центра (тренажерные залы, баня/сауны, прокат и т.д.).",
  ].join("\n");

  const isLeak = __assistantRouteTestHooks.looksLikeDiningDistractorLeakReply(leakReply);
  assert.equal(isLeak, true);
});

test("dining venue candidate filter keeps restaurants and rejects sports centers", () => {
  const restaurant = makeVendorCandidate({
    id: "rest-1",
    name: "Ресторан Тест",
    primary_rubric_name: "Кафе, бары, рестораны",
    description: "Кафе и ресторан в центре Минска",
  });
  const sportsCenter = makeVendorCandidate({
    id: "sport-1",
    name: "ФОЦ Тест",
    primary_rubric_name: "Фитнес-центры, тренажерные залы",
    description: "Спортивно-оздоровительный центр, баня и сауна",
  });

  assert.equal(__assistantRouteTestHooks.looksLikeDiningVenueCandidate(restaurant), true);
  assert.equal(__assistantRouteTestHooks.looksLikeDiningVenueCandidate(sportsCenter), false);
});

test("culture intent recognizes phrase 'что посмотреть сегодня'", () => {
  const isCultureIntent = __assistantRouteTestHooks.looksLikeCultureVenueIntent("Что посмотреть сегодня");
  assert.equal(isCultureIntent, true);

  const hardReply = __assistantRouteTestHooks.buildHardFormattedReply("Что посмотреть сегодня", []);
  assert.ok(hardReply);
  assert.match(String(hardReply), /кинотеатры\/театры/u);
});

test("cinema where-to-go request is routed to direct rubric links without clarifying block", () => {
  const hardReply = __assistantRouteTestHooks.buildHardFormattedReply("Куда сходить посмотреть фильмы", []);
  assert.ok(hardReply);
  assert.match(String(hardReply), /Я\s+подобрал\s+вам\s+релевантные\s+рубрики/u);
  assert.match(String(hardReply), /\/catalog\/turizm-otdyh-dosug\/kinoteatry/u);
  assert.match(String(hardReply), /\/catalog\/iskusstvo-suveniry-yuvelirnye-izdeliya\/doma-kultury-kinoteatry/u);
  assert.match(String(hardReply), /используйте\s+фильтр:\s*поисковую\s+строку/u);
  assert.doesNotMatch(String(hardReply), /нужно\s+уточнить\s+несколько\s+вопрос/u);
});

test("travel where-to-go request is routed to tour rubrics without clarifying block", () => {
  const hardReply = __assistantRouteTestHooks.buildHardFormattedReply("Куда слетать", []);
  assert.ok(hardReply);
  assert.match(String(hardReply), /Я\s+подобрал\s+вам\s+релевантные\s+рубрики/u);
  assert.match(String(hardReply), /\/catalog\/turizm-otdyh-dosug\/turfirmy-turoperatory/u);
  assert.match(String(hardReply), /\/catalog\/turizm-otdyh-dosug\/turizm-turisticheskie-agentstva/u);
  assert.match(String(hardReply), /используйте\s+фильтр:\s*поисковую\s+строку/u);
  assert.doesNotMatch(String(hardReply), /скажите\s*2-3\s+параметр/u);
  assert.doesNotMatch(String(hardReply), /уточнить\s+несколько\s+вопрос/u);
});

test("bicycle sourcing request is routed to two sports rubrics", () => {
  const hardReply = __assistantRouteTestHooks.buildHardFormattedReply("Ищу велосипед", []);
  assert.ok(hardReply);
  assert.match(String(hardReply), /Я\s+подобрал\s+вам\s+релевантные\s+рубрики/u);
  assert.match(String(hardReply), /Спортивные\s+принадлежности:\s*\/catalog\/sport-zdorove-krasota\/sportivnye-prinadlejnosti/u);
  assert.match(String(hardReply), /Спортивные\s+товары,\s*снаряжение:\s*\/catalog\/sport-zdorove-krasota\/sportivnye-tovary-snaryajenie/u);
});

test("culture distractor leak is detected for mixed museum and ritual shortlist", () => {
  const leakReply = [
    "Короткий план на срочный запрос:",
    "1. Лидский историко-художественный музей — /company/museum",
    "2. Грин-Стоун ООО — /company/green-stone (Ритуальные услуги; Минск)",
    "3. ЭлектротехИмпорт ООО — /company/electro (Промышленное оборудование)",
  ].join("\n");

  const isLeak = __assistantRouteTestHooks.looksLikeCultureVenueDistractorReply(leakReply);
  assert.equal(isLeak, true);
});

test("vendor ranking with dining fish semantics keeps only venue candidates", () => {
  const restaurant = makeVendorCandidate({
    id: "rest-fish-sem",
    name: "Рыбный Причал",
    primary_rubric_name: "Кафе, бары, рестораны",
    description: "Рыбный ресторан, жареная рыба и морепродукты в центре Минска",
  });
  const supplier = makeVendorCandidate({
    id: "fish-wholesale",
    name: "Рыбная База Опт",
    primary_rubric_name: "Рыбная продукция оптом",
    description: "Оптовая продажа охлажденной и замороженной рыбы",
  });

  const ranked = __assistantRouteTestHooks.filterAndRankVendorCandidates({
    companies: [supplier, restaurant],
    searchTerms: ["ресторан", "рыба", "морепродукты"],
    region: null,
    city: "Минск",
    limit: 5,
    sourceText: "где в Минске можно вкусно поесть даренную рыбу",
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, "rest-fish-sem");
});

test("dining nearby ranking prefers nearest candidates for nearest intent", () => {
  const far = makeVendorCandidate({
    id: "rest-far",
    name: "Ресторан Дальний",
    primary_rubric_name: "Кафе, бары, рестораны",
    description: "Ресторан",
    _distanceMeters: 1200,
  });
  const near = makeVendorCandidate({
    id: "rest-near",
    name: "Ресторан Ближайший",
    primary_rubric_name: "Кафе, бары, рестораны",
    description: "Ресторан",
    _distanceMeters: 220,
  });

  const ranked = __assistantRouteTestHooks.rankDiningNearbyCandidates({
    candidates: [far, near],
    searchText: "Выдай ближайшие варианты, где поесть в Минске",
    preferNearest: true,
    limit: 6,
  });
  assert.equal(ranked[0]?.id, "rest-near");
});

test("dining nearby ranking can prioritize fish-relevant venue without nearest cue", () => {
  const generic = makeVendorCandidate({
    id: "rest-generic",
    name: "Ресторан Город",
    primary_rubric_name: "Кафе, бары, рестораны",
    description: "Ресторан европейской кухни",
    _distanceMeters: 300,
  });
  const fish = makeVendorCandidate({
    id: "rest-fish",
    name: "Рыбный ресторан",
    primary_rubric_name: "Кафе, бары, рестораны",
    description: "Жареная рыба, рыбные блюда и морепродукты",
    _distanceMeters: 900,
  });

  const ranked = __assistantRouteTestHooks.rankDiningNearbyCandidates({
    candidates: [generic, fish],
    searchText: "где поесть жареную рыбу в Минске",
    preferNearest: false,
    limit: 6,
  });
  assert.equal(ranked[0]?.id, "rest-fish");
});

test("dining nearby ranking handles fish typo phrase and boosts seafood venues", () => {
  const generic = makeVendorCandidate({
    id: "rest-generic-sea",
    name: "Ресторан Город",
    primary_rubric_name: "Кафе, бары, рестораны",
    description: "Европейская кухня",
    _distanceMeters: 250,
  });
  const seafood = makeVendorCandidate({
    id: "rest-seafood",
    name: "Морской Дом",
    primary_rubric_name: "Кафе, бары, рестораны",
    description: "Морепродукты на гриле и seafood-меню",
    _distanceMeters: 900,
  });

  const ranked = __assistantRouteTestHooks.rankDiningNearbyCandidates({
    candidates: [generic, seafood],
    searchText: "Где поблизости можно поесть даренную рыбу в Минске",
    preferNearest: false,
    limit: 6,
  });
  assert.equal(ranked[0]?.id, "rest-seafood");
});

test("dining street hint extraction supports phrase with 'на <улица>'", () => {
  const hint = __assistantRouteTestHooks.extractDiningStreetHint("Где поесть на Скрипникова в Минске");
  assert.equal(hint, "скрипникова");
});

test("dining street hint extraction ignores metro landmarks", () => {
  const hint = __assistantRouteTestHooks.extractDiningStreetHint("Мне нужно кафе в районе метро Фрунзенская");
  assert.equal(hint, null);
});

test("dining street filter keeps only candidates with matching address street", () => {
  const wrongStreet = makeVendorCandidate({
    id: "rest-tim",
    name: "Beef&Beer",
    address: "Минск, Тимирязева, 65",
    primary_rubric_name: "Кафе, бары, рестораны",
    description: "Пивной ресторан",
  });
  const rightStreet = makeVendorCandidate({
    id: "rest-skr",
    name: "Кафе у Скрипникова",
    address: "Минск, Скрипникова, 11",
    primary_rubric_name: "Кафе, бары, рестораны",
    description: "Кафе",
  });

  const filtered = __assistantRouteTestHooks.filterDiningCandidatesByStreetHint(
    [wrongStreet, rightStreet],
    "скрипникова",
  );

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "rest-skr");
});

test("vendor ranking for sugar commodity keeps supplier and filters agri-service distractor", () => {
  const sugarSupplier = makeVendorCandidate({
    id: "sugar-supplier",
    name: "Городейский сахарный комбинат",
    primary_rubric_name: "Сахар, кондитерское сырье оптом",
    description: "Сахар-песок, сахар фасованный, оптовые поставки сахара по Беларуси",
  });
  const agriDistractor = makeVendorCandidate({
    id: "agri-service",
    name: "Молодечненский райагросервис",
    primary_rubric_name: "Сервис сельхозтехники",
    description: "Сахарная свекла, уборка и ремонтная мастерская сельхозтехники",
  });

  const ranked = __assistantRouteTestHooks.filterAndRankVendorCandidates({
    companies: [agriDistractor, sugarSupplier],
    searchTerms: ["сахар", "оптом", "200 кг"],
    region: null,
    city: "Минск",
    limit: 5,
    sourceText: "нужен сахар оптом в Минске, объем 200 кг",
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, "sugar-supplier");
});

test("vendor ranking excludes government authorities for public bathhouse lookup", () => {
  const govAuthority = makeVendorCandidate({
    id: "gov-authority-1",
    name: "Администрация Московского района г. Минска",
    primary_rubric_name: "Органы власти и управления Минска, Минского района и области",
    primary_category_name: "Государство и общество",
    description: "Государственный орган исполнительной власти",
  });
  const bathhouse = makeVendorCandidate({
    id: "bathhouse-1",
    name: "Баня №1",
    primary_rubric_name: "Бани и сауны",
    primary_category_name: "Услуги",
    description: "Общественная баня и сауна в Минске",
  });

  const ranked = __assistantRouteTestHooks.filterAndRankVendorCandidates({
    companies: [govAuthority, bathhouse],
    searchTerms: ["баня", "минск"],
    region: null,
    city: "Минск",
    limit: 5,
    sourceText: "где найти общественную баню в минске",
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, "bathhouse-1");
});

test("vendor ranking returns empty when only government authorities exist for bathhouse lookup", () => {
  const govAuthority = makeVendorCandidate({
    id: "gov-authority-only",
    name: "Администрация Московского района г. Минска",
    primary_rubric_name: "Органы власти и управления Минска, Минского района и области",
    primary_category_name: "Государство и общество",
    description: "Государственный орган исполнительной власти",
  });

  const ranked = __assistantRouteTestHooks.filterAndRankVendorCandidates({
    companies: [govAuthority],
    searchTerms: ["баня", "минск"],
    region: null,
    city: "Минск",
    limit: 5,
    sourceText: "где найти общественную баню в минске",
  });

  assert.equal(ranked.length, 0);
});

test("sourcing sugar distractor leak is rewritten to relevant shortlist without kaliningrad/cleaning narrative", () => {
  const sugarSupplier = makeVendorCandidate({
    id: "sugar-supplier",
    name: "Городейский сахарный комбинат",
    primary_rubric_name: "Сахар, кондитерское сырье оптом",
    description: "Сахар-песок, сахар фасованный, оптовые поставки сахара по Беларуси",
  });
  const cleaningDistractor = makeVendorCandidate({
    id: "cleaning-distractor",
    name: "Клининг Плюс",
    primary_rubric_name: "Клининговые услуги",
    description: "Клининг, уборка помещений, химчистка",
  });

  const result = __assistantRouteTestHooks.postProcessAssistantReply({
    replyText: [
      "Понял. Нужен **сахар оптом в Минске, объем 200 кг**.",
      "По текущей выдаче каталога вижу только 1 кандидата, и он **не релевантен сахару** (клининг/уборочные материалы),",
      "поэтому могу предложить вариант из Калининграда.",
    ].join("\n"),
    message: "дай кандидатов",
    history: [
      { role: "user", content: "нужен сахар оптом в Минске, объем 200 кг" },
      { role: "assistant", content: "Уточните, пожалуйста, город и объем." },
    ],
    mode: { templateRequested: false, rankingRequested: false, checklistRequested: false },
    rubricHintItems: [],
    vendorCandidates: [cleaningDistractor, sugarSupplier],
    vendorLookupContext: {
      shouldLookup: true,
      searchText: "нужен сахар оптом в Минске, объем 200 кг",
      region: null,
      city: "Минск",
      derivedFromHistory: true,
      sourceMessage: "нужен сахар оптом в Минске, объем 200 кг",
      excludeTerms: [],
    },
  });

  assert.match(result, /Актуальные кандидаты/u);
  assert.match(result, /\/company\/sugar-supplier/u);
  assert.doesNotMatch(result, /калининград/u);
  assert.doesNotMatch(result, /клининг/u);
  assert.doesNotMatch(result, /не\s+релевант/u);
});

test("rubric-only catalog reply in lookup follow-up is rewritten to rubric navigation flow", () => {
  const result = __assistantRouteTestHooks.postProcessAssistantReply({
    replyText: [
      "Если хотите, сделаю сразу версию под отправку на e-mail с официальной подачей.",
      "Только существующие рубрики портала (проверено по каталогу):",
      "1. Металлы и металлообработка — /catalog/metally-metalloobrabotka",
      "2. Обращение с коммунальными отходами — /catalog/uslugi-dlya-naseleniya/obrashchenie-s-kommunalnymi-othodami",
    ].join("\n"),
    message: "Минск",
    history: [{ role: "user", content: "нужен подрядчик по вывозу металлолома" }],
    mode: { templateRequested: false, rankingRequested: false, checklistRequested: false },
    rubricHintItems: [
      {
        type: "rubric",
        slug: "metally-metalloobrabotka",
        name: "Металлы и металлообработка",
        url: "/catalog/metally-metalloobrabotka",
        category_slug: "metally",
        category_name: "Металлы",
        count: 128,
      },
    ],
    vendorCandidates: [],
    vendorLookupContext: {
      shouldLookup: true,
      searchText: "нужен подрядчик по вывозу металлолома минск",
      region: null,
      city: "Минск",
      derivedFromHistory: true,
      sourceMessage: "нужен подрядчик по вывозу металлолома",
      excludeTerms: [],
    },
  });

  assert.match(result, /Я\s+подобрал\s+вам\s+релевантные\s+рубрики/u);
  assert.match(result, /Металлы и металлообработка:\s*\/catalog\/metally-metalloobrabotka/u);
  assert.doesNotMatch(result, /без\s+уточняющих\s+вопросов/u);
  assert.match(result, /\/catalog\/metally-metalloobrabotka/u);
  assert.doesNotMatch(result, /Для того чтобы помочь Вам, мне нужно уточнить несколько вопросов/u);
  assert.doesNotMatch(result, /\/company\//u);
  assert.doesNotMatch(result, /под\s+отправк\p{L}*\s+на\s+e-?mail/u);
});

test("rubric navigation reply appends top-3 companies ranked by card completeness", () => {
  const rich = makeVendorCandidate({
    id: "alpha",
    name: "Альфа Молоко ООО",
    description:
      "Производство молочной продукции, сыров и масла. Поставки для retail и horeca, полный цикл переработки молока.",
    primary_rubric_name: "Молочная промышленность",
    primary_category_name: "Пищевая промышленность",
  });
  rich.about =
    "О компании: современный молочный комплекс, логистика по регионам, ассортимент молочной продукции и услуг фасовки.";
  rich.websites = ["https://alpha-milk.by"];
  rich.emails = ["sales@alpha-milk.by"];
  rich.logo_url = "https://alpha-milk.by/logo.png";
  rich.phones_ext = [{ number: "+375 (17) 111-11-11", labels: ["офис"] }];

  const medium = makeVendorCandidate({
    id: "beta",
    name: "Бета Фуд ООО",
    description: "Поставки продуктов питания и молочных товаров.",
    primary_rubric_name: "Продукты питания",
    primary_category_name: "Пищевая промышленность",
  });
  medium.websites = ["https://beta-food.by"];

  const light = makeVendorCandidate({
    id: "gamma",
    name: "Гамма Торг ООО",
    description: "Оптовая торговля.",
    primary_rubric_name: "Оптовая торговля",
    primary_category_name: "Торговля",
  });
  light.phones = [];
  light.websites = [];
  light.emails = [];

  const result = __assistantRouteTestHooks.postProcessAssistantReply({
    replyText: [
      "Только существующие рубрики портала (проверено по каталогу):",
      "1. Молочная промышленность — /catalog/produkty-pitaniya/molochnaya-promyshlennost",
    ].join("\n"),
    message: "где купить молоко",
    history: [],
    mode: { templateRequested: false, rankingRequested: false, checklistRequested: false },
    rubricHintItems: [
      {
        type: "rubric",
        slug: "molochnaya-promyshlennost",
        name: "Молочная промышленность",
        url: "/catalog/produkty-pitaniya/molochnaya-promyshlennost",
        category_slug: "produkty-pitaniya",
        category_name: "Пищевая промышленность",
        count: 87,
      },
    ],
    vendorCandidates: [light, medium, rich],
    vendorLookupContext: {
      shouldLookup: true,
      searchText: "где купить молоко",
      region: null,
      city: "Минск",
      derivedFromHistory: false,
      sourceMessage: "где купить молоко",
      excludeTerms: [],
    },
  });

  assert.match(result, /Я\s+подобрал\s+вам\s+релевантные\s+рубрики/u);
  assert.match(result, /Топ-3\s+компани[ий]\s+по\s+вашему\s+запросу/u);
  assert.match(result, /\/company\/alpha/u);
  assert.match(result, /\/company\/beta/u);
  assert.match(result, /\/company\/gamma/u);

  const alphaPos = result.indexOf("/company/alpha");
  const betaPos = result.indexOf("/company/beta");
  const gammaPos = result.indexOf("/company/gamma");
  assert.ok(alphaPos >= 0 && betaPos >= 0 && gammaPos >= 0);
  assert.ok(alphaPos < betaPos);
  assert.ok(betaPos < gammaPos);
});

test("first-pass broad product query is redirected to rubric without clarifying questions", () => {
  const result = __assistantRouteTestHooks.postProcessAssistantReply({
    replyText: [
      "Подобрал компании из каталога по вашему запросу:",
      "1. Молочный Дом ООО — /company/molochnyy-dom",
      "2. Белмолпродукт ООО — /company/belmolprodukt",
    ].join("\n"),
    message: "где купить молоко",
    history: [],
    mode: { templateRequested: false, rankingRequested: false, checklistRequested: false },
    rubricHintItems: [
      {
        type: "rubric",
        slug: "molochnaya-promyshlennost",
        name: "Молочная промышленность",
        url: "/catalog/produkty-pitaniya/molochnaya-promyshlennost",
        category_slug: "produkty-pitaniya",
        category_name: "Пищевая промышленность",
        count: 87,
      },
    ] as any,
    vendorCandidates: [],
    vendorLookupContext: {
      shouldLookup: true,
      searchText: "где купить молоко",
      region: null,
      city: null,
      derivedFromHistory: false,
      sourceMessage: "где купить молоко",
      excludeTerms: [],
    },
  });

  assert.match(result, /Я\s+подобрал\s+вам\s+релевантные\s+рубрики/u);
  assert.match(result, /Молочная промышленность:\s*\/catalog\/produkty-pitaniya\/molochnaya-promyshlennost/u);
  assert.doesNotMatch(result, /без\s+уточняющих\s+вопросов/u);
  assert.match(result, /\/catalog\/produkty-pitaniya\/molochnaya-promyshlennost/u);
  assert.doesNotMatch(result, /уточнить несколько вопросов/u);
  assert.doesNotMatch(result, /\/company\//u);
});

test("unsolicited email version offer is stripped in sourcing flow without company cards", () => {
  const result = __assistantRouteTestHooks.postProcessAssistantReply({
    replyText: [
      "Понял задачу. Поиск продолжаю.",
      "Если хотите, сделаю сразу версию под отправку на e-mail с местом под реквизиты.",
      "После этого можно обсудить детали.",
    ].join("\n"),
    message: "нужен поставщик сахара в Минске",
    history: [{ role: "user", content: "сахар оптом 200 кг Минск" }],
    mode: { templateRequested: false, rankingRequested: false, checklistRequested: false },
    rubricHintItems: [],
    vendorCandidates: [],
    vendorLookupContext: {
      shouldLookup: true,
      searchText: "сахар оптом 200 кг минск",
      region: null,
      city: "Минск",
      derivedFromHistory: true,
      sourceMessage: "сахар оптом 200 кг минск",
      excludeTerms: [],
    },
  });

  assert.doesNotMatch(result, /под\s+отправк\p{L}*\s+на\s+e-?mail/u);
});

test("bread bakery no-results leak is rewritten to bakery clarifying flow", () => {
  const result = __assistantRouteTestHooks.postProcessAssistantReply({
    replyText: [
      "Могу помочь, но уточню в 2 словах: вы ищете где заказать выпечку хлеба или как испечь самому?",
      "По текущим данным каталога biznesinfo.by у меня нет релевантных карточек пекарен/хлебозаводов в выданных кандидатах.",
      "Поэтому не буду предлагать нерелевантные компании.",
    ].join("\n"),
    message: "Где испечь хлеб",
    history: [{ role: "user", content: "Где испечь хлеб" }],
    mode: { templateRequested: false, rankingRequested: false, checklistRequested: false },
    rubricHintItems: [],
    vendorCandidates: [],
    vendorLookupContext: {
      shouldLookup: true,
      searchText: "где испечь хлеб",
      region: null,
      city: null,
      derivedFromHistory: false,
      sourceMessage: "Где испечь хлеб",
      excludeTerms: [],
    },
  });

  assert.match(result, /Подбираю релевантные карточки пекарен и хлебозаводов/u);
  assert.match(result, /Нужна выпечка хлеба на заказ/u);
  assert.match(result, /Открыть карточки с фильтром:/u);
  assert.doesNotMatch(result, /нет\s+релевантн\p{L}*\s+карточк/u);
});

test("hairdresser generic advice leak is detected", () => {
  const leakReply = [
    "Отличный вопрос 🙂",
    "Чтобы подсказать реально подходящий вариант, уточните, пожалуйста, 3 вещи:",
    "1. Какая у Вас длина волос сейчас (короткие / средние / длинные)?",
    "2. Для чего прическа: на каждый день, на работу, на праздник/свадьбу?",
    "3. Вы в каком городе Беларуси?",
    "Подберу мастеров/салоны из каталога рядом с Вами.",
  ].join("\n");

  const isLeak = __assistantRouteTestHooks.looksLikeHairdresserGenericAdviceReply(leakReply);
  assert.equal(isLeak, true);
});

test("hairdresser budget question leak is rewritten to direct rubric flow without price questions", () => {
  const result = __assistantRouteTestHooks.postProcessAssistantReply({
    replyText: [
      "Отлично, район Фрунзенской понятен 👍",
      "Чтобы не промахнуться по цене, уточните, пожалуйста, бюджет за женскую стрижку:",
      "",
      "1. До 40 BYN",
      "2. 40–80 BYN",
      "3. От 80 BYN",
    ].join("\n"),
    message: "Фрунзенская",
    history: [
      { role: "user", content: "постричься" },
      { role: "assistant", content: "Уточните, пожалуйста, район." },
    ],
    mode: { templateRequested: false, rankingRequested: false, checklistRequested: false },
    rubricHintItems: [],
    vendorCandidates: [],
    vendorLookupContext: {
      shouldLookup: true,
      searchText: "постричься фрунзенская",
      region: null,
      city: "Минск",
      derivedFromHistory: true,
      sourceMessage: "постричься",
      excludeTerms: [],
    },
  });

  assert.doesNotMatch(result, /Я не парикмахер/u);
  assert.match(result, /Сразу направляю в профильные рубрики каталога/u);
  assert.match(result, /поисков[а-я]*\s+строк/u);
  assert.doesNotMatch(result, /бюджет|byn|по\s+цене/u);
});

test("hairdresser card-link request leak is rewritten to autonomous salon flow", () => {
  const result = __assistantRouteTestHooks.postProcessAssistantReply({
    replyText: [
      "Конечно, помогу с мелированием в Минске.",
      "Но чтобы не вводить Вас в заблуждение, мне нужно сначала получить карточки компаний из каталога (названия и ссылки).",
      "Сейчас в чате их нет, поэтому пришлите результаты поиска.",
    ].join("\n"),
    message: "мелирование в Минске",
    history: [{ role: "user", content: "мелирование в Минске" }],
    mode: { templateRequested: false, rankingRequested: false, checklistRequested: false },
    rubricHintItems: [],
    vendorCandidates: [],
    vendorLookupContext: {
      shouldLookup: true,
      searchText: "мелирование минск",
      region: null,
      city: "Минск",
      derivedFromHistory: false,
      sourceMessage: "мелирование в Минске",
      excludeTerms: [],
    },
  });

  assert.doesNotMatch(result, /Я не парикмахер/u);
  assert.match(result, /Сразу направляю в профильные рубрики каталога/u);
  assert.match(result, /поисков[а-я]*\s+строк/u);
  assert.doesNotMatch(result, /пришлит|ссылк|карточк\p{L}*[^.\n]{0,60}(?:нужн|нет)/u);
});

test("where haircut request is routed to salon lookup flow without 'not hairdresser' disclaimer", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Где постричься") || "";
  assert.doesNotMatch(result, /Я не парикмахер/u);
  assert.match(result, /Сразу направляю в профильные рубрики каталога/u);
  assert.match(result, /поисков[а-я]*\s+строк/u);
  assert.doesNotMatch(result, /Как хотите постричься/u);
  assert.match(result, /\/search\?service=парикмахерские/u);
});

test("semantic expansion adds related terms for colloquial signage request", () => {
  const expanded = __assistantRouteTestHooks.suggestSemanticExpansionTerms("Кто делает вывески?");
  assert.ok(expanded.includes("наружная реклама"));
  assert.ok(expanded.includes("производство вывесок"));
});

test("semantic expansion adds sugar sourcing related terms", () => {
  const expanded = __assistantRouteTestHooks.suggestSemanticExpansionTerms("Нужен сахар оптом в Минске");
  assert.ok(expanded.includes("сахар оптом"));
  assert.ok(expanded.includes("бакалея"));
});

test("semantic expansion adds bakery terms for bread baking request", () => {
  const expanded = __assistantRouteTestHooks.suggestSemanticExpansionTerms("Где испечь хлеб в Минске");
  assert.ok(expanded.includes("пекарня"));
  assert.ok(expanded.includes("хлебозавод"));
});

test("semantic expansion adds agriculture terms for rye sourcing request", () => {
  const expanded = __assistantRouteTestHooks.suggestSemanticExpansionTerms("Хочу купить рожь");
  assert.ok(expanded.includes("сельское хозяйство"));
  assert.ok(expanded.includes("зерно"));
});

test("stylist generic advice leak is detected", () => {
  const leakReply = [
    "Отличный вопрос 🙂 Чтобы посоветовать действительно уместно, уточню 2 момента:",
    "1. В каком формате проходит 8 марта?",
    "2. Какой стиль Вам ближе: более нарядно или более комфортно?",
    "",
    "Если хотите, сразу соберу варианты образов под Ваш формат и бюджет.",
  ].join("\n");

  const isLeak = __assistantRouteTestHooks.looksLikeStylistGenericAdviceReply(leakReply);
  assert.equal(isLeak, true);
});

test("cooking intent is redirected to where-to-buy products flow", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("что приготовить на ужин в Минске") || "";
  assert.match(result, /Я не повар/u);
  assert.match(result, /где купить продукты/u);
  assert.match(result, /\/search\?/u);
  assert.doesNotMatch(result, /вариант(ы)?\s+блюд/u);
});

test("cooking intent redirects salting fish query to where-to-buy flow", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Как засолить рыбу") || "";
  assert.match(result, /Я не повар/u);
  assert.match(result, /где купить продукты/u);
  assert.match(result, /\/search\?/u);
  assert.doesNotMatch(result, /базовый\s+способ/u);
});

test("fish soup cooking flow excludes dairy category and prioritizes fish categories", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Как приготовить уху в Минске") || "";
  assert.match(result, /Я не повар/u);
  assert.match(result, /Рыба и морепродукты/u);
  assert.match(result, /\/search\?service=рыба/u);
  assert.doesNotMatch(result, /Молочные\s+продукты/u);
});

test("weather request is redirected to portal scope with no weather cards claim", () => {
  const result = __assistantRouteTestHooks.buildHardFormattedReply("Какая погода сейчас в Минске") || "";
  assert.match(result, /Я не гидрометцентр/u);
  assert.match(result, /только с подбором карточек компаний/u);
  assert.match(result, /нет релевантных карточек компаний/u);
  assert.doesNotMatch(result, /подскажу\s+актуальную\s+погоду/u);
});

test("cooking generic advice leak is detected", () => {
  const leakReply = [
    "Отличный вопрос 🙂 Чтобы подсказать действительно удачный вариант, уточните, пожалуйста, 2 момента:",
    "1. Для кого ужин: только для Вас или на семью?",
    "2. Сколько есть времени на готовку: до 20 минут или около часа?",
    "3. Есть ли ограничения (без мяса/без молочного/ПП)?",
    "",
    "Если хотите, сразу дам 3 быстрых варианта под Ваши ответы.",
  ].join("\n");

  const isLeak = __assistantRouteTestHooks.looksLikeCookingGenericAdviceReply(leakReply);
  assert.equal(isLeak, true);
});

test("cooking misroute shortlist leak is detected for non-food company cards", () => {
  const leakReply = [
    "Фокус по локации: Минск.",
    "Дальше могу сделать топ-3 по прозрачным критериям: релевантность, локация, полнота контактов, риски.",
    "Быстрый first-pass по релевантным компаниям из каталога:",
    "1. Белсветимпорт ООО — /company/biznesinfo.by-82145",
    "(Осветительные приборы; Минск)",
  ].join("\n");

  const isLeak = __assistantRouteTestHooks.looksLikeCookingShoppingMisrouteReply(leakReply);
  assert.equal(isLeak, true);
});

test("cooking recipe leak is detected for fish salting template", () => {
  const leakReply = [
    "Чтобы вкусно и безопасно засолить рыбу дома, вот простой базовый способ (сухой посол).",
    "### 1) Что нужно",
    "- Рыба (лосось, форель, скумбрия, сельдь и т.д.)",
    "- Соль крупная не йодированная",
    "- Сахар",
    "- Перец, лавровый лист — по желанию",
  ].join("\n");

  const isLeak = __assistantRouteTestHooks.looksLikeCookingGenericAdviceReply(leakReply);
  assert.equal(isLeak, true);
});

test("normalizer rewrites unsupported card fields in generic checklist", () => {
  const source = [
    "Напишите, что нужно найти:",
    "1. товар или услугу,",
    "2. город/регион,",
    "3. важные условия (срок, бюджет, объём).",
  ].join("\n");

  const result = __assistantRouteTestHooks.normalizeShortlistWording(source);
  assert.match(result, /скорость ответа, надежность, полнота контактов/u);
  assert.doesNotMatch(result, /срок,\s*бюджет,\s*объ[её]м/u);
});

test("normalizer removes accommodation budget line variant from free-form answer", () => {
  const source = [
    "Отличный запрос. Уточните, пожалуйста, формат размещения.",
    "Если подойдёт, сразу напишите район Минска и бюджет за ночь — так дам релевантные карточки.",
  ].join("\n");

  const result = __assistantRouteTestHooks.normalizeShortlistWording(source);
  assert.doesNotMatch(result, /бюджет/u);
  assert.match(result, /формат размещения/u);
});

test("final quality gate strips markdown artifacts and normalizes portal brand", () => {
  const source = [
    "Понял: **Минск, санаторий**.",
    "По текущему списку компаний из каталога бизнесинфоточка бай подходящих санаториев не найдено.",
  ].join("\n");

  const result = __assistantRouteTestHooks.applyFinalAssistantQualityGate({
    replyText: source,
    message: "Минск, санаторий",
    history: [],
  });

  assert.doesNotMatch(result, /\*\*/u);
  assert.match(result, /biznesinfo\.by/u);
  assert.doesNotMatch(result, /бизнесинфоточк/iu);
});

test("final quality gate rewrites sanatorium no-results conflict with hotel shortlist", () => {
  const source = [
    "Понял: **Минск, санаторий**.",
    "По текущему списку компаний из каталога бизнесинфоточка бай подходящих санаториев в Минске не найдено.",
    "1. **Виктория гостиница** — гостиничный комплекс в Минске, не санаторий.",
    "2. **Пралеска отель** — размещение в центре города.",
  ].join("\n");

  const result = __assistantRouteTestHooks.applyFinalAssistantQualityGate({
    replyText: source,
    message: "Минск, санаторий",
    history: [],
  });

  assert.match(result, /подходящих санаториев не найдено/u);
  assert.match(result, /уточните,\s*пожалуйста/u);
  assert.doesNotMatch(result, /Виктория/u);
  assert.doesNotMatch(result, /Пралеска/u);
  assert.doesNotMatch(result, /\*\*/u);
});

test("final quality gate rewrites dining shortlist to city clarification when current message has no geo", () => {
  const source = [
    "Конечно! Вот варианты из каталога **biznesinfo.by**, где можно поесть:",
    "1. **Дом папочки ООО (Минск)** — пиццерия с более неформальным форматом и недорогой едой.",
    "/company/dompapr",
  ].join("\n");

  const result = __assistantRouteTestHooks.applyFinalAssistantQualityGate({
    replyText: source,
    message: "Где можно поесть",
    history: [{ role: "user", content: "Минск" }],
  });

  assert.match(result, /В каком городе\/регионе ищете/u);
  assert.doesNotMatch(result, /\/company\/dompapr/u);
  assert.doesNotMatch(result, /сейчас вижу:/u);
});

test("final quality gate replaces deprecated clarifying question block with filter guidance", () => {
  const source = [
    "Понял запрос: «молоко». Для того чтобы помочь Вам, мне нужно уточнить несколько вопросов:",
    "Открыть карточки с фильтром: /search?service=молоко",
    "1. Покупка нужна оптом или в розницу?",
    "2. Есть ли какие-то обязательные условия по товару либо по поставке?",
    "3. Какой город/регион приоритетный?",
    "После ответа на эти вопросы сразу продолжу подбор.",
  ].join("\n");

  const result = __assistantRouteTestHooks.applyFinalAssistantQualityGate({
    replyText: source,
    message: "молоко",
    history: [],
  });

  assert.match(result, /используйте\s+фильтр:\s*поисковую\s+строку/u);
  assert.match(result, /фильтрацию\s+по\s+товарам\s+либо\s+услугам/u);
  assert.match(result, /\/search\?service=молоко/u);
  assert.doesNotMatch(result, /Для того чтобы помочь Вам/u);
  assert.doesNotMatch(result, /Покупка нужна оптом или в розницу/u);
  assert.doesNotMatch(result, /После ответа на эти вопросы/u);
});

test("final quality gate keeps culture clarifying flow and does not replace it with filter guidance", () => {
  const source = [
    "Для того чтобы помочь Вам, мне нужно уточнить несколько вопросов:",
    "1. В каком городе/районе ищете кинотеатры/театры?",
    "2. Нужны кинотеатры (сеансы фильма) или добавить театры/концертные площадки?",
    "3. На когда нужен поход: сегодня, конкретная дата или ближайшие выходные?",
    "4. Что важнее: конкретный фильм и время сеанса, классика или современная программа?",
    "После ответа подберу релевантные карточки кинотеатров, театров и культурных площадок из каталога biznesinfo.by.",
  ].join("\n");

  const result = __assistantRouteTestHooks.applyFinalAssistantQualityGate({
    replyText: source,
    message: "Что посмотреть сегодня",
    history: [],
  });

  assert.match(result, /кинотеатры\/театры/u);
  assert.match(result, /На когда нужен поход/u);
  assert.doesNotMatch(result, /используйте\s+фильтр:\s*поисковую\s+строку/u);
});

test("fish pricing query is treated as product flow without generic товар/услуга question", () => {
  const result = __assistantRouteTestHooks.buildSourcingClarifyingQuestionsReply({
    message: "По чем сегодня рыба",
    history: [],
    locationHint: null,
  });

  assert.match(result, /Покупка нужна оптом или в розницу/u);
  assert.doesNotMatch(result, /товар\s+или\s+услуг/u);
  assert.doesNotMatch(result, /рыба,\s*чем\s*рыба/u);
  assert.match(result, /Понял запрос:\s*«рыба»/u);
});

test("tooth treatment query is recognized as dentistry domain", () => {
  const domain = __assistantRouteTestHooks.detectSourcingDomainTag("Где полечить зубы в Минске");
  assert.equal(domain, "dentistry");
});

test("dentistry ranking filters out sports and catering distractors for tooth query", () => {
  const dentistry = makeVendorCandidate({
    id: "dent-clinic-1",
    name: "Стоматологическая клиника Улыбка",
    primary_rubric_name: "Стоматологические услуги",
    primary_category_name: "Медицина и фармацевтика",
    description: "Где полечить зубы: лечение кариеса и каналов под микроскопом в Минске",
  });
  const sportDistractor = makeVendorCandidate({
    id: "sport-center-1",
    name: "Городской центр олимпийского резерва по теннису",
    primary_rubric_name: "Спортивные клубы, общества и сооружения",
    primary_category_name: "Спорт, здоровье, красота",
    description: "Тренировки по теннису и аренда кортов в Минске",
  });
  const cateringDistractor = makeVendorCandidate({
    id: "catering-combine-1",
    name: "Городской комбинат социального питания",
    primary_rubric_name: "Общественное питание",
    primary_category_name: "Торговля и услуги",
    description: "Организация школьного и корпоративного питания в Минске",
  });

  const ranked = __assistantRouteTestHooks.filterAndRankVendorCandidates({
    companies: [sportDistractor, dentistry, cateringDistractor],
    searchTerms: ["зубы", "кариес", "стоматология", "минск"],
    region: null,
    city: "Минск",
    limit: 5,
    sourceText: "Где полечить зубы в Минске",
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, "dent-clinic-1");
});

test("rubric picker avoids government rubrics for bread retail intent", () => {
  const hint = __assistantRouteTestHooks.pickPrimaryRubricHintForClarification({
    message: "Розница Минск",
    seedText: "где купить хлеб розница минск",
    hints: [
      {
        type: "rubric",
        name: "Органы власти и управления Минска, Минского района и области",
        slug: "organy-vlasti-i-upravleniya-minska-minskogo-rayona-i-oblasti",
        url: "/catalog/gosudarstvo-i-obshchestvo/organy-vlasti-i-upravleniya-minska-minskogo-rayona-i-oblasti",
        count: 390,
      } as any,
      {
        type: "rubric",
        name: "Хлебозаводы и пекарни",
        slug: "hlebozavody-i-pekarni",
        url: "/catalog/produkty-pitaniya/hlebozavody-i-pekarni",
        count: 42,
      } as any,
    ],
  });

  assert.ok(hint);
  assert.equal(hint?.slug, "hlebozavody-i-pekarni");
});

test("rubric picker avoids government rubrics for public bathhouse intent", () => {
  const hint = __assistantRouteTestHooks.pickPrimaryRubricHintForClarification({
    message: "Общественное посещение бани Минск",
    seedText: "общественное посещение бани минск",
    hints: [
      {
        type: "rubric",
        name: "Органы власти и управления Минска, Минского района и области",
        slug: "organy-vlasti-i-upravleniya-minska-minskogo-rayona-i-oblasti",
        url: "/catalog/gosudarstvo-i-obshchestvo/organy-vlasti-i-upravleniya-minska-minskogo-rayona-i-oblasti",
        count: 390,
      } as any,
      {
        type: "rubric",
        name: "Бани и сауны",
        slug: "bani-i-sauny",
        url: "/catalog/uslugi/bani-i-sauny",
        category_slug: "uslugi",
        category_name: "Услуги",
        count: 28,
      } as any,
    ],
  });

  assert.ok(hint);
  assert.equal(hint?.slug, "bani-i-sauny");
});

test("rubric picker returns null when only government rubrics remain for service intent", () => {
  const hint = __assistantRouteTestHooks.pickPrimaryRubricHintForClarification({
    message: "Общественное посещение бани Минск",
    seedText: "общественное посещение бани минск",
    hints: [
      {
        type: "rubric",
        name: "Органы власти и управления Минска, Минского района и области",
        slug: "organy-vlasti-i-upravleniya-minska-minskogo-rayona-i-oblasti",
        url: "/catalog/gosudarstvo-i-obshchestvo/organy-vlasti-i-upravleniya-minska-minskogo-rayona-i-oblasti",
        count: 390,
      } as any,
    ],
  });

  assert.equal(hint, null);
});

test("rubric picker prefers forestry rubric over broad agriculture for timber intent", () => {
  const hint = __assistantRouteTestHooks.pickPrimaryRubricHintForClarification({
    message: "Где купить лес",
    seedText: "где купить лес",
    hints: [
      {
        type: "rubric",
        name: "Сельское хозяйство",
        slug: "selskoe-hozyaystvo",
        url: "/catalog/apk-selskoe-i-lesnoe-hozyaystvo/selskoe-hozyaystvo",
        category_slug: "apk-selskoe-i-lesnoe-hozyaystvo",
        category_name: "АПК, сельское и лесное хозяйство",
        count: 1414,
      } as any,
      {
        type: "rubric",
        name: "Лесное хозяйство",
        slug: "lesnoe-hozyaystvo",
        url: "/catalog/apk-selskoe-i-lesnoe-hozyaystvo/lesnoe-hozyaystvo",
        category_slug: "apk-selskoe-i-lesnoe-hozyaystvo",
        category_name: "АПК, сельское и лесное хозяйство",
        count: 289,
      } as any,
    ],
  });

  assert.ok(hint);
  assert.equal(hint?.slug, "lesnoe-hozyaystvo");
});
