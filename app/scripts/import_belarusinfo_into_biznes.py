#!/usr/bin/env python3
"""
Import companies from Info/belarusinfo.sqlite3 into biznes.lucheestiy.com JSONL catalog.

Key behavior:
- Keeps existing non-belarusinfo companies from the current JSONL.
- Rebuilds all belarusinfo companies from SQLite (idempotent).
- Maps Belarusinfo rubric/category into the existing IBIZ category structure (slugs used by the site).
- Skips duplicates (conservative): phone OR email OR corporate domain OR exact (name+address) match.
- Removes any belarusinfo.by links from public fields (websites + source_url).

Typical usage (from repo root):
  python3 biznes.lucheestiy.com/app/scripts/import_belarusinfo_into_biznes.py --in-place
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote, urlparse


IBIZ_CATEGORY_URL_PREFIX = "https://ibiz.by/"

# Conservative list: domains that are frequently shared across many companies,
# so they are not useful for dedupe by domain.
IGNORED_DOMAINS = {
    "2gis.by",
    "2gis.com",
    "bit.ly",
    "clck.ru",
    "facebook.com",
    "goo.gl",
    "instagram.com",
    "linkedin.com",
    "maps.google.com",
    "ok.ru",
    "t.me",
    "telegram.me",
    "twitter.com",
    "vk.com",
    "yadi.sk",
    "yandex.by",
    "yandex.ru",
    "youtube.com",
}


BELARUSINFO_CATEGORY_TO_IBIZ_CATEGORY: dict[str, str] = {
    "avtomobili": "avtomobilnaya-tehnika-uslugi-transport",
    "bezopasnost": "gosudarstvo-i-obshchestvo",
    "biznes-i-finansy-yurisprudentsiya": "biznes-uslugi-dlya-biznesa",
    "gosudarstvo": "gosudarstvo-i-obshchestvo",
    "kompyutery-i-internet": "it-internet-i-orgtehnika",
    "krasota-i-zdorove-meditsina": "sport-zdorove-krasota",
    "kultura-i-iskusstvo": "iskusstvo-suveniry-yuvelirnye-izdeliya",
    "lesnoe-hozyaystvo-selskoe-hozyaystvo-sadovodstvo": "apk-selskoe-i-lesnoe-hozyaystvo",
    "mebel-tovary-dlya-doma-i-ofisa": "derevoobrabotka-i-mebel",
    "nauka-i-prosveschenie": "obrazovanie-nauka-karera",
    "nedvijimost": "nedvizhimost",
    "promyshlennost": "mashinostroenie-i-oborudovanie",
    "reklama-i-poligrafiya": "reklamnaya-deyatelnost-smi",
    "semya-deti": "uslugi-dlya-naseleniya",
    "shou-biznes": "turizm-otdyh-dosug",
    "sotsialnaya-sfera": "gosudarstvo-i-obshchestvo",
    "sredstva-massovoy-informatsii": "reklamnaya-deyatelnost-smi",
    "stroitelstvo": "stroitelstvo-nedvijimost",
    "telekommunikatsii-i-svyaz": "telekommunikatsii-i-svyaz",
    "torgovlya": "torgovlya-logistika",
    "transport-i-perevozki": "transport-logistika-perevozki",
    "turizm-sport-otdyh-i-razvlecheniya": "turizm-otdyh-dosug",
    "uslugi-i-servis": "uslugi-dlya-naseleniya",
}


def now_utc_compact() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def norm_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def norm_text(value: str) -> str:
    return norm_space(value).casefold()


def uniq_keep_order(values: Iterable[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        s = (v or "").strip()
        if not s:
            continue
        if s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def normalize_phone(raw: str) -> str:
    digits = "".join(re.findall(r"\d+", raw or ""))
    # Belarus phones tend to be "375..." when present; keep as-is otherwise.
    return digits


def normalize_email(raw: str) -> str:
    return (raw or "").strip().casefold()


def hostname_from_url(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    try:
        u = urlparse(s if "://" in s else f"https://{s}")
        host = (u.hostname or "").casefold()
    except Exception:
        return ""
    if host.startswith("www."):
        host = host[4:]
    return host


def normalize_domain(raw: str) -> str:
    host = hostname_from_url(raw)
    if not host:
        return ""
    # Strip common subdomains so "m.site.by" and "www.site.by" match.
    host = host.lstrip(".")
    parts = host.split(".")
    if len(parts) >= 3 and parts[0] in {"m", "mobile"}:
        host = ".".join(parts[1:])
    return host


def is_belarusinfo_link(raw: str) -> bool:
    if "belarusinfo.by" in (raw or "").casefold():
        return True
    host = hostname_from_url(raw)
    return host == "belarusinfo.by" or host.endswith(".belarusinfo.by")


def is_ignored_domain(host: str) -> bool:
    h = (host or "").casefold()
    if not h:
        return True
    if h in IGNORED_DOMAINS:
        return True
    for base in IGNORED_DOMAINS:
        if h.endswith(f".{base}"):
            return True
    return False


_RU_TRANSLIT = {
    "а": "a",
    "б": "b",
    "в": "v",
    "г": "g",
    "д": "d",
    "е": "e",
    "ё": "e",
    "ж": "zh",
    "з": "z",
    "и": "i",
    "й": "y",
    "к": "k",
    "л": "l",
    "м": "m",
    "н": "n",
    "о": "o",
    "п": "p",
    "р": "r",
    "с": "s",
    "т": "t",
    "у": "u",
    "ф": "f",
    "х": "h",
    "ц": "ts",
    "ч": "ch",
    "ш": "sh",
    "щ": "sch",
    "ъ": "",
    "ы": "y",
    "ь": "",
    "э": "e",
    "ю": "yu",
    "я": "ya",
}


def translit_ru(value: str) -> str:
    out: list[str] = []
    for ch in (value or "").casefold():
        out.append(_RU_TRANSLIT.get(ch, ch))
    return "".join(out)


def slugify_segment(value: str) -> str:
    raw = translit_ru(unquote((value or "").strip()))
    raw = raw.replace("&", " and ")
    raw = raw.replace("ё", "e")
    raw = re.sub(r"[^a-z0-9]+", "-", raw.casefold())
    raw = re.sub(r"-{2,}", "-", raw).strip("-")
    return raw or "rubric"


def parse_belarusinfo_rubric_url(url: str) -> tuple[str, str]:
    """
    Returns (belarusinfo_category_slug, belarusinfo_rubric_segment_slug).
    Example: https://www.belarusinfo.by/ru/company/transport-i-perevozki/transportnye-uslugi.html
      -> ("transport-i-perevozki", "transportnye-uslugi")
    """
    try:
        path = urlparse(url).path or ""
    except Exception:
        return ("", "")
    parts = [p for p in path.split("/") if p]
    if len(parts) < 4:
        return ("", "")
    # /ru/company/<cat>/<rubric>.html
    if parts[0] != "ru" or parts[1] != "company":
        return ("", "")
    cat = parts[2]
    last = parts[-1]
    if last.lower().endswith(".html"):
        last = last[: -len(".html")]
    rubric_segment = slugify_segment(last)
    return (cat, rubric_segment)


def extract_city(address: str) -> str:
    s = norm_space(address)
    if not s:
        return ""
    s = re.sub(r"^\s*2\d{5}\s*", "", s)
    s = s.lstrip(",; ")
    city = (s.split(",", 1)[0] if "," in s else s).strip()
    city = re.sub(r"^(г\.|город)\s*", "", city, flags=re.IGNORECASE).strip()
    if len(city) > 80:
        return ""
    return city


def choose_target_category_slug(belarusinfo_category: str, rubric_name: str) -> str:
    base = BELARUSINFO_CATEGORY_TO_IBIZ_CATEGORY.get(belarusinfo_category, "uslugi-dlya-naseleniya")
    name = norm_text(rubric_name)

    # Fine-grained overrides where Belarusinfo buckets are broader than IBIZ.
    if belarusinfo_category == "biznes-i-finansy-yurisprudentsiya":
        if any(k in name for k in ["банк", "кредит", "лизинг", "страх", "финанс", "бирж"]):
            return "banki-birji-finansy"
        return base

    if belarusinfo_category == "krasota-i-zdorove-meditsina":
        if any(
            k in name
            for k in [
                "аптек",
                "больниц",
                "клиник",
                "лаборатор",
                "мед",
                "поликлин",
                "стомат",
                "фарма",
            ]
        ):
            return "medicina-i-farmacevtika"
        return base

    if belarusinfo_category in {"reklama-i-poligrafiya", "sredstva-massovoy-informatsii"}:
        if any(k in name for k in ["полиграф", "типог", "упаков", "печать", "издат", "этикет"]):
            return "poligrafiya-izdatelstvo-upakovka"
        return "reklamnaya-deyatelnost-smi"

    if belarusinfo_category == "stroitelstvo":
        if any(k in name for k in ["строймат", "материал", "кирпич", "бетон", "плитк", "обои", "краск"]):
            return "strojmateriali-otdelochnie-materiali"
        return base

    if belarusinfo_category == "promyshlennost":
        if any(k in name for k in ["пищ", "напит", "кондитер", "хлеб", "молочн"]):
            return "promyshlennost-pishchevaya"
        if any(k in name for k in ["хим", "энерг", "нефт", "газ", "топлив", "котел", "отоплен"]):
            return "himiya-energetika-syre"
        if any(k in name for k in ["металл", "металло", "литей", "сварк"]):
            return "metally-metalloobrabotka"
        if any(k in name for k in ["текстил", "швей", "одеж", "обув", "кож", "трикотаж"]):
            return "legkaya-promyshlennost"
        return base

    if belarusinfo_category == "mebel-tovary-dlya-doma-i-ofisa":
        if any(k in name for k in ["бытов", "техник", "электро", "инструмент"]):
            return "dom-i-byt-bytovye-uslugi"
        return base

    if belarusinfo_category == "turizm-sport-otdyh-i-razvlecheniya":
        if any(k in name for k in ["фитнес", "спорт", "spa", "спа"]):
            return "sport-zdorove-krasota"
        return base

    return base


@dataclass(frozen=True)
class CategoryRef:
    slug: str
    name: str
    url: str


@dataclass(frozen=True)
class RubricRef:
    slug: str
    name: str
    url: str
    category_slug: str
    category_name: str


def load_existing_catalog(jsonl_path: Path) -> tuple[list[dict[str, Any]], dict[str, CategoryRef], dict[str, RubricRef], dict[str, list[str]]]:
    kept: list[dict[str, Any]] = []
    categories_by_slug: dict[str, CategoryRef] = {}
    rubrics_by_slug: dict[str, RubricRef] = {}
    rubric_slugs_by_norm_name: dict[str, list[str]] = defaultdict(list)

    with jsonl_path.open("r", encoding="utf-8") as f:
        for line in f:
            raw = line.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except Exception:
                continue

            if obj.get("source") == "belarusinfo":
                continue

            # Site policy: remove any belarusinfo.by links from public fields globally.
            obj["websites"] = clean_websites(obj.get("websites") or [])
            if is_belarusinfo_link(obj.get("source_url") or ""):
                obj["source_url"] = ""
            if "description" in obj:
                obj["description"] = strip_belarusinfo_urls(str(obj.get("description") or ""))
            if "about" in obj:
                obj["about"] = strip_belarusinfo_urls(str(obj.get("about") or ""))

            kept.append(obj)

            for c in obj.get("categories") or []:
                slug = (c.get("slug") or "").strip()
                name = (c.get("name") or slug).strip()
                if not slug:
                    continue
                if slug not in categories_by_slug:
                    categories_by_slug[slug] = CategoryRef(
                        slug=slug,
                        name=name,
                        url=(c.get("url") or f"{IBIZ_CATEGORY_URL_PREFIX}{slug}").strip(),
                    )

            for r in obj.get("rubrics") or []:
                slug = (r.get("slug") or "").strip()
                if not slug:
                    continue
                category_slug = (r.get("category_slug") or "").strip()
                category_name = (r.get("category_name") or category_slug).strip()
                name = (r.get("name") or slug).strip()
                url = (r.get("url") or "").strip()
                if slug not in rubrics_by_slug:
                    rubrics_by_slug[slug] = RubricRef(
                        slug=slug,
                        name=name,
                        url=url,
                        category_slug=category_slug,
                        category_name=category_name,
                    )
                rubric_slugs_by_norm_name[norm_text(name)].append(slug)

    return kept, categories_by_slug, rubrics_by_slug, rubric_slugs_by_norm_name


def build_dedupe_sets(companies: list[dict[str, Any]]) -> tuple[set[str], set[str], set[str], set[str]]:
    phones: set[str] = set()
    emails: set[str] = set()
    domains: set[str] = set()
    name_addr: set[str] = set()

    for obj in companies:
        for p in obj.get("phones") or []:
            np = normalize_phone(p)
            if len(np) >= 9:
                phones.add(np)
        for e in obj.get("emails") or []:
            ne = normalize_email(e)
            if ne:
                emails.add(ne)
        for w in obj.get("websites") or []:
            host = normalize_domain(w)
            if not host or is_ignored_domain(host) or is_belarusinfo_link(w):
                continue
            domains.add(host)

        n = norm_text(obj.get("name") or "")
        a = norm_text(obj.get("address") or "")
        if n and a:
            name_addr.add(f"{n}||{a}")

    return phones, emails, domains, name_addr


def load_belarusinfo_rubrics(conn: sqlite3.Connection) -> dict[int, list[tuple[str, str]]]:
    rubrics_by_company: dict[int, list[tuple[str, str]]] = defaultdict(list)
    for row in conn.execute(
        "SELECT company_id, rubric_name, rubric_url FROM company_rubrics ORDER BY company_id, rubric_name"
    ):
        try:
            company_id = int(row[0])
        except Exception:
            continue
        name = (row[1] or "").strip()
        url = (row[2] or "").strip()
        if not url:
            continue
        rubrics_by_company[company_id].append((name, url))
    return rubrics_by_company


def clean_websites(raw_list: list[str]) -> list[str]:
    out: list[str] = []
    for w in raw_list or []:
        s = (w or "").strip()
        if not s:
            continue
        if is_belarusinfo_link(s):
            continue
        if s.lower().startswith(("mailto:", "tel:")):
            continue
        if not re.match(r"^https?://", s, flags=re.IGNORECASE):
            # Keep socials (vk, insta) consistent with ibiz: they are still valid https links.
            s = f"https://{s}"
        out.append(s)
    return uniq_keep_order(out)


_BELARUSINFO_URL_RE = re.compile(r"https?://[^\s]*belarusinfo\.by[^\s]*", flags=re.IGNORECASE)
_BELARUSINFO_BARE_RE = re.compile(r"(?:www\.)?belarusinfo\.by(?:/[^\s]*)?", flags=re.IGNORECASE)


def strip_belarusinfo_urls(text: str) -> str:
    if not text:
        return ""
    cleaned = _BELARUSINFO_URL_RE.sub("", text)
    cleaned = _BELARUSINFO_BARE_RE.sub("", cleaned)
    return norm_space(cleaned)


def ensure_category_ref(
    categories_by_slug: dict[str, CategoryRef], category_slug: str
) -> CategoryRef:
    if category_slug in categories_by_slug:
        return categories_by_slug[category_slug]
    # Fallback: keep the site working even if the base dataset missed the category.
    ref = CategoryRef(slug=category_slug, name=category_slug, url=f"{IBIZ_CATEGORY_URL_PREFIX}{category_slug}")
    categories_by_slug[category_slug] = ref
    return ref


def unique_rubric_slug(base_slug: str, used: set[str]) -> str:
    if base_slug not in used:
        used.add(base_slug)
        return base_slug
    i = 2
    while f"{base_slug}-{i}" in used:
        i += 1
    out = f"{base_slug}-{i}"
    used.add(out)
    return out


def build_belarusinfo_company(
    *,
    company_id: int,
    name: str,
    excerpt: str,
    about: str,
    address: str,
    phones: list[str],
    emails: list[str],
    websites: list[str],
    rubrics: list[tuple[str, str]],
    categories_by_slug: dict[str, CategoryRef],
    rubrics_by_slug: dict[str, RubricRef],
    rubric_slugs_by_norm_name: dict[str, list[str]],
    used_rubric_slugs: set[str],
    rubric_ref_by_bi_url: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    stats: dict[str, Any] = {}
    clean_name = norm_space(name)
    clean_address = norm_space(address)
    if not clean_name:
        stats["skip_reason"] = "missing_name"
        return None, stats
    if not rubrics:
        stats["skip_reason"] = "missing_rubrics"
        return None, stats

    out_rubrics: list[dict[str, Any]] = []
    out_categories: dict[str, CategoryRef] = {}

    for rubric_name, rubric_url in rubrics:
        cached = rubric_ref_by_bi_url.get(rubric_url)
        if cached:
            cat_slug = (cached.get("category_slug") or "").strip()
            if cat_slug:
                out_categories[cat_slug] = ensure_category_ref(categories_by_slug, cat_slug)
            out_rubrics.append(cached)
            continue

        rubric_name = norm_space(rubric_name) or "—"
        norm_r_name = norm_text(rubric_name)

        target_slug: str | None = None
        if norm_r_name in rubric_slugs_by_norm_name:
            candidates = rubric_slugs_by_norm_name[norm_r_name]
            if len(candidates) == 1:
                target_slug = candidates[0]
            else:
                bi_cat, _ = parse_belarusinfo_rubric_url(rubric_url)
                desired_cat = choose_target_category_slug(bi_cat, rubric_name)
                for cand in candidates:
                    ref = rubrics_by_slug.get(cand)
                    if ref and ref.category_slug == desired_cat:
                        target_slug = cand
                        break
                target_slug = target_slug or candidates[0]

        if target_slug and target_slug in rubrics_by_slug:
            ref = rubrics_by_slug[target_slug]
            cat_ref = ensure_category_ref(categories_by_slug, ref.category_slug)
            out_categories[cat_ref.slug] = cat_ref
            out_ref = {
                "slug": ref.slug,
                "name": ref.name or rubric_name,
                "url": ref.url or "",
                "category_slug": ref.category_slug,
                "category_name": ref.category_name or cat_ref.name,
            }
            out_rubrics.append(out_ref)
            rubric_ref_by_bi_url[rubric_url] = out_ref
            continue

        bi_cat, bi_rubric_segment = parse_belarusinfo_rubric_url(rubric_url)
        category_slug = choose_target_category_slug(bi_cat, rubric_name)
        cat_ref = ensure_category_ref(categories_by_slug, category_slug)
        out_categories[cat_ref.slug] = cat_ref

        rubric_segment = bi_rubric_segment or slugify_segment(rubric_name)
        base_slug = f"{category_slug}/{rubric_segment}"

        # If the slug already exists with a different name, create a unique variant.
        if base_slug in rubrics_by_slug and norm_text(rubrics_by_slug[base_slug].name) != norm_r_name:
            base_slug = f"{base_slug}-bi"
        slug = unique_rubric_slug(base_slug, used_rubric_slugs)

        out_ref = {
            "slug": slug,
            "name": rubric_name,
            "url": "",
            "category_slug": category_slug,
            "category_name": cat_ref.name,
        }
        out_rubrics.append(out_ref)
        rubric_ref_by_bi_url[rubric_url] = out_ref

    if not out_rubrics:
        stats["skip_reason"] = "no_mapped_rubrics"
        return None, stats

    phones = uniq_keep_order(phones or [])
    emails = uniq_keep_order([normalize_email(e) for e in (emails or []) if normalize_email(e)])
    websites = clean_websites(websites or [])

    description = strip_belarusinfo_urls(norm_space(excerpt) or norm_space(about))

    city = extract_city(clean_address)
    about_clean = strip_belarusinfo_urls(norm_space(about))

    obj: dict[str, Any] = {
        "source": "belarusinfo",
        "source_id": f"belarusinfo-{company_id}",
        # Public policy: no belarusinfo.by links on the site.
        "source_url": "",
        "name": clean_name,
        "unp": "",
        "country": "BY",
        "region": "",
        "city": city,
        "address": clean_address,
        "phones": phones,
        "phones_ext": [],
        "emails": emails,
        "websites": websites,
        "description": description,
        "about": about_clean,
        "contact_person": "",
        "logo_url": "",
        "work_hours": {},
        "categories": [
            {"slug": c.slug, "name": c.name, "url": c.url} for c in sorted(out_categories.values(), key=lambda x: x.slug)
        ],
        "rubrics": out_rubrics,
        "extra": {"lat": None, "lng": None},
    }

    return obj, stats


def import_belarusinfo(
    *,
    belarusinfo_db: Path,
    existing_jsonl: Path,
    output_jsonl: Path,
    max_companies: int | None,
    in_place: bool,
    backup: bool,
    dry_run: bool,
) -> None:
    if not existing_jsonl.exists():
        raise FileNotFoundError(f"Existing catalog JSONL not found: {existing_jsonl}")
    if not belarusinfo_db.exists():
        raise FileNotFoundError(f"Belarusinfo DB not found: {belarusinfo_db}")

    kept, categories_by_slug, rubrics_by_slug, rubric_slugs_by_norm_name = load_existing_catalog(existing_jsonl)

    existing_phones, existing_emails, existing_domains, existing_name_addr = build_dedupe_sets(kept)

    conn = sqlite3.connect(f"file:{belarusinfo_db}?mode=ro", uri=True)
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        rubrics_by_company = load_belarusinfo_rubrics(conn)

        cur = conn.execute(
            "SELECT id, name, excerpt, about, address, phones_json, emails_json, websites_json FROM companies WHERE status='done' ORDER BY id"
        )

        imported: list[dict[str, Any]] = []
        duplicates = Counter()
        skipped = Counter()

        # Track dedupe keys across newly imported rows too.
        new_phones: set[str] = set()
        new_emails: set[str] = set()
        new_domains: set[str] = set()
        new_name_addr: set[str] = set()

        used_rubric_slugs: set[str] = set(rubrics_by_slug.keys())
        rubric_ref_by_bi_url: dict[str, dict[str, Any]] = {}

        processed = 0
        for row in cur:
            company_id = int(row[0])
            processed += 1
            if max_companies is not None and len(imported) >= max_companies:
                break

            name = row[1] or ""
            excerpt = row[2] or ""
            about = row[3] or ""
            address = row[4] or ""
            try:
                phones = json.loads(row[5] or "[]")
            except Exception:
                phones = []
            try:
                emails = json.loads(row[6] or "[]")
            except Exception:
                emails = []
            try:
                websites = json.loads(row[7] or "[]")
            except Exception:
                websites = []

            rubrics = rubrics_by_company.get(company_id, [])

            obj, _stats = build_belarusinfo_company(
                company_id=company_id,
                name=name,
                excerpt=excerpt,
                about=about,
                address=address,
                phones=phones,
                emails=emails,
                websites=websites,
                rubrics=rubrics,
                categories_by_slug=categories_by_slug,
                rubrics_by_slug=rubrics_by_slug,
                rubric_slugs_by_norm_name=rubric_slugs_by_norm_name,
                used_rubric_slugs=used_rubric_slugs,
                rubric_ref_by_bi_url=rubric_ref_by_bi_url,
            )

            if not obj:
                skipped[_stats.get("skip_reason", "unknown")] += 1
                continue

            # Dedupe: skip only on strong signals.
            key_name = norm_text(obj.get("name") or "")
            key_addr = norm_text(obj.get("address") or "")
            key_name_addr = f"{key_name}||{key_addr}" if key_name and key_addr else ""

            matched_reason = ""
            for p in obj.get("phones") or []:
                np = normalize_phone(p)
                if len(np) >= 9 and (np in existing_phones or np in new_phones):
                    matched_reason = "phone"
                    break
            if not matched_reason:
                for e in obj.get("emails") or []:
                    ne = normalize_email(e)
                    if ne and (ne in existing_emails or ne in new_emails):
                        matched_reason = "email"
                        break
            if not matched_reason:
                for w in obj.get("websites") or []:
                    host = normalize_domain(w)
                    if not host or is_ignored_domain(host):
                        continue
                    if host in existing_domains or host in new_domains:
                        matched_reason = "domain"
                        break
            if not matched_reason and key_name_addr:
                if key_name_addr in existing_name_addr or key_name_addr in new_name_addr:
                    matched_reason = "name_address"

            if matched_reason:
                duplicates[matched_reason] += 1
                continue

            # Update new dedupe sets.
            for p in obj.get("phones") or []:
                np = normalize_phone(p)
                if len(np) >= 9:
                    new_phones.add(np)
            for e in obj.get("emails") or []:
                ne = normalize_email(e)
                if ne:
                    new_emails.add(ne)
            for w in obj.get("websites") or []:
                host = normalize_domain(w)
                if not host or is_ignored_domain(host):
                    continue
                new_domains.add(host)
            if key_name_addr:
                new_name_addr.add(key_name_addr)

            imported.append(obj)

        combined_count = len(kept) + len(imported)
        print(f"Existing kept (non-belarusinfo): {len(kept)}")
        print(f"Belarusinfo imported: {len(imported)} (processed done rows: {processed})")
        if duplicates:
            print("Duplicates skipped:", dict(duplicates))
        if skipped:
            print("Skipped:", dict(skipped))
        print(f"Combined total lines: {combined_count}")

        report = {
            "existing_kept": len(kept),
            "imported": len(imported),
            "processed_done_rows": processed,
            "duplicates": dict(duplicates),
            "skipped": dict(skipped),
            "output_jsonl": str(output_jsonl),
        }
        print("Report:", json.dumps(report, ensure_ascii=False))

        if dry_run:
            return

        dst = existing_jsonl if in_place else output_jsonl
        dst.parent.mkdir(parents=True, exist_ok=True)

        if backup and in_place and existing_jsonl.exists():
            backup_path = existing_jsonl.with_suffix(f".backup-{now_utc_compact()}.jsonl")
            print(f"Backup: {existing_jsonl} -> {backup_path}")
            backup_path.write_bytes(existing_jsonl.read_bytes())

        tmp_path = dst.with_suffix(dst.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8") as f:
            for obj in kept:
                f.write(json.dumps(obj, ensure_ascii=False) + "\n")
            for obj in imported:
                f.write(json.dumps(obj, ensure_ascii=False) + "\n")

        os.replace(tmp_path, dst)
        print(f"Wrote: {dst}")
    finally:
        conn.close()


def main() -> int:
    app_dir = Path(__file__).resolve().parent.parent
    default_existing = app_dir / "public" / "data" / "ibiz" / "companies.jsonl"
    default_output = app_dir / "public" / "data" / "ibiz" / "companies.with-belarusinfo.jsonl"
    default_db = Path("/home/mlweb/Info/belarusinfo.sqlite3")

    p = argparse.ArgumentParser(description="Import belarusinfo.sqlite3 into biznes.lucheestiy.com JSONL catalog")
    p.add_argument("--belarusinfo-db", default=str(default_db), help="Path to Info/belarusinfo.sqlite3")
    p.add_argument("--existing-jsonl", default=str(default_existing), help="Existing catalog companies.jsonl path")
    p.add_argument("--output-jsonl", default=str(default_output), help="Output JSONL path (if not --in-place)")
    p.add_argument("--max-companies", type=int, default=0, help="Limit imported companies (0 = no limit)")
    p.add_argument("--in-place", action="store_true", help="Overwrite --existing-jsonl (recommended with --backup)")
    p.add_argument("--backup", action="store_true", help="Create a timestamped backup before overwriting")
    p.add_argument("--dry-run", action="store_true", help="Do not write files, only print summary")
    args = p.parse_args()

    import_belarusinfo(
        belarusinfo_db=Path(args.belarusinfo_db),
        existing_jsonl=Path(args.existing_jsonl),
        output_jsonl=Path(args.output_jsonl),
        max_companies=(args.max_companies if args.max_companies and args.max_companies > 0 else None),
        in_place=bool(args.in_place),
        backup=bool(args.backup),
        dry_run=bool(args.dry_run),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
