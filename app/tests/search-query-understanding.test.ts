import assert from "node:assert/strict";
import test from "node:test";

import { understandBiznesinfoSearchQuery } from "../src/lib/search/queryUnderstanding";

test("moves natural-language product request from q into service and extracts city/format", () => {
  const out = understandBiznesinfoSearchQuery({
    query: "Где купить сахар оптом в Минске 200 кг",
  });

  assert.equal(out.intent, "product_lookup");
  assert.equal(out.searchParams.query, "");
  assert.equal(out.searchParams.city, "Минск");
  assert.equal(out.entities.format, "wholesale");
  assert.match(out.searchParams.service, /сахар/u);
  assert.equal(out.entities.quantity, "200 кг");
});

test("keeps company-like query in company lookup mode", () => {
  const out = understandBiznesinfoSearchQuery({
    query: "ADT center ООО",
  });

  assert.equal(out.intent, "company_lookup");
  assert.equal(out.searchParams.query, "ADT center ООО");
  assert.equal(out.searchParams.service, "");
});

test("detects service request and extracts city from q", () => {
  const out = understandBiznesinfoSearchQuery({
    query: "ремонт холодильников в Гродно",
  });

  assert.equal(out.intent, "service_lookup");
  assert.equal(out.searchParams.query, "");
  assert.equal(out.searchParams.city, "Гродно");
  assert.match(out.searchParams.service, /ремонт/u);
  assert.match(out.searchParams.service, /холодиль/u);
});

test("keeps explicit service input and enriches semantic keywords", () => {
  const out = understandBiznesinfoSearchQuery({
    service: "рыба",
    city: "Минск",
  });

  assert.equal(out.intent, "product_lookup");
  assert.equal(out.searchParams.service, "рыба");
  assert.equal(out.searchParams.city, "Минск");
  assert.equal(out.searchParams.region, null);
  assert.ok(out.searchParams.keywords);
  assert.match(out.searchParams.keywords || "", /(морепродукт|рыбка|seafood|fish)/u);
});

test("colloquial request about signboards expands to outdoor advertising terms", () => {
  const out = understandBiznesinfoSearchQuery({
    query: "Кто делает вывески",
  });

  assert.equal(out.intent, "service_lookup");
  assert.equal(out.searchParams.query, "");
  assert.match(out.searchParams.service, /вывеск/u);
  assert.match(out.searchParams.keywords || "", /(наружн|реклам|полиграф|производств)/u);
});

test("colloquial roof request is normalized to roofing works", () => {
  const out = understandBiznesinfoSearchQuery({
    query: "Нужны ребята сделать крышу",
  });

  assert.equal(out.intent, "service_lookup");
  assert.equal(out.searchParams.query, "");
  assert.match(out.searchParams.service, /крыш/u);
  assert.match(out.searchParams.keywords || "", /(кровл|монтаж|ремонт|строит)/u);
});

test("colloquial greens request is recognized as product lookup", () => {
  const out = understandBiznesinfoSearchQuery({
    query: "Где взять зелень",
  });

  assert.equal(out.intent, "product_lookup");
  assert.equal(out.searchParams.query, "");
  assert.match(out.searchParams.service, /зелень/u);
  assert.match(out.searchParams.keywords || "", /(овощ|продукт|продоволь|поставщик|оптов)/u);
});
