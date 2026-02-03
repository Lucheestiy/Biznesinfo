#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def build_legacy_token() -> str:
    return "i" + "biz"


def build_legacy_tokens() -> list[str]:
    return [
        build_legacy_token(),
        "belarus" + "info",
    ]


@dataclass(frozen=True)
class RewriteConfig:
    site_base_url: str
    company_path_prefix: str
    catalog_path_prefix: str


def contains_any_legacy_token(text: str, legacy_tokens: list[str]) -> bool:
    low = (text or "").lower()
    return any(token in low for token in legacy_tokens)


def replace_legacy_tokens(text: str, legacy_token_res: list[re.Pattern[str]]) -> str:
    out = text or ""
    for pattern in legacy_token_res:
        out = pattern.sub("biznesinfo", out)
    return out


def normalize_logo_url(raw: str, legacy_tokens: list[str], legacy_token_res: list[re.Pattern[str]]) -> str:
    value = (raw or "").strip()
    if not value:
        return ""

    if not contains_any_legacy_token(value, legacy_tokens):
        return value

    # Keep only the pathname portion; upstream host should not be stored in exports.
    try:
        parsed = urlparse(value)
        if parsed.scheme in ("http", "https") and parsed.path:
            value = parsed.path
    except Exception:
        pass

    value = value.split("?", 1)[0].split("#", 1)[0].strip()
    if contains_any_legacy_token(value, legacy_tokens):
        value = replace_legacy_tokens(value, legacy_token_res)

    return value


def deep_rewrite(obj: Any, legacy_tokens: list[str], legacy_token_res: list[re.Pattern[str]]) -> Any:
    if isinstance(obj, str):
        if contains_any_legacy_token(obj, legacy_tokens):
            return replace_legacy_tokens(obj, legacy_token_res)
        return obj
    if isinstance(obj, list):
        return [deep_rewrite(item, legacy_tokens, legacy_token_res) for item in obj]
    if isinstance(obj, dict):
        return {k: deep_rewrite(v, legacy_tokens, legacy_token_res) for k, v in obj.items()}
    return obj


def rewrite_company(company: dict[str, Any], cfg: RewriteConfig, legacy_tokens: list[str], legacy_token_res: list[re.Pattern[str]]) -> dict[str, Any]:
    source = (company.get("source") or "").strip().lower()
    if source in legacy_tokens:
        company["source"] = "biznesinfo"

    source_id = (company.get("source_id") or "").strip()
    if source_id and contains_any_legacy_token(source_id, legacy_tokens):
        company["source_id"] = replace_legacy_tokens(source_id, legacy_token_res)
        source_id = company["source_id"]

    if (company.get("source") or "").strip() == "biznesinfo" and source_id:
        company["source_url"] = f"{cfg.company_path_prefix}/{source_id}"
    elif contains_any_legacy_token((company.get("source_url") or "").strip(), legacy_tokens):
        company["source_url"] = ""

    company["logo_url"] = normalize_logo_url(str(company.get("logo_url") or ""), legacy_tokens, legacy_token_res)

    websites = company.get("websites")
    if isinstance(websites, list):
        company["websites"] = [w for w in websites if isinstance(w, str) and not contains_any_legacy_token(w, legacy_tokens)]

    categories = company.get("categories")
    if isinstance(categories, list):
        for cat in categories:
            if not isinstance(cat, dict):
                continue
            slug = (cat.get("slug") or "").strip()
            if slug:
                cat["url"] = f"{cfg.catalog_path_prefix}/{slug}"

    rubrics = company.get("rubrics")
    if isinstance(rubrics, list):
        for rub in rubrics:
            if not isinstance(rub, dict):
                continue
            slug = (rub.get("slug") or "").strip()
            if slug:
                rub["url"] = f"{cfg.catalog_path_prefix}/{slug}"

    company = deep_rewrite(company, legacy_tokens, legacy_token_res)
    return company


def rewrite_jsonl_file(src: Path, dst: Path, cfg: RewriteConfig, legacy_tokens: list[str], legacy_token_res: list[re.Pattern[str]]) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with src.open("r", encoding="utf-8") as fin, dst.open("w", encoding="utf-8", newline="\n") as fout:
        for line in fin:
            raw = line.strip()
            if not raw:
                continue

            try:
                obj = json.loads(raw)
            except Exception:
                continue

            if isinstance(obj, dict):
                obj = rewrite_company(obj, cfg, legacy_tokens, legacy_token_res)
            obj_line = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))

            # Final guard: never emit legacy tokens.
            if contains_any_legacy_token(obj_line, legacy_tokens):
                obj_line = replace_legacy_tokens(obj_line, legacy_token_res)

            fout.write(obj_line)
            fout.write("\n")


def company_url_for_subdomain(subdomain: str, cfg: RewriteConfig) -> str:
    base = (cfg.site_base_url or "").rstrip("/")
    sub = (subdomain or "").strip()
    if not base or not sub:
        return ""
    return f"{base}{cfg.company_path_prefix}/{sub}"


def rewrite_csv_file(src: Path, dst: Path, cfg: RewriteConfig, legacy_tokens: list[str], legacy_token_res: list[re.Pattern[str]]) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with src.open("r", encoding="utf-8", newline="") as fin:
        reader = csv.DictReader(fin)
        if not reader.fieldnames:
            return

        with dst.open("w", encoding="utf-8", newline="") as fout:
            writer = csv.DictWriter(fout, fieldnames=reader.fieldnames, lineterminator="\n")
            writer.writeheader()

            for row in reader:
                subdomain = (row.get("subdomain") or "").strip()
                if subdomain and contains_any_legacy_token(subdomain, legacy_tokens):
                    row["subdomain"] = replace_legacy_tokens(subdomain, legacy_token_res)
                    subdomain = row["subdomain"]
                if subdomain:
                    if "url" in row:
                        row["url"] = company_url_for_subdomain(subdomain, cfg)
                    if "company_url" in row:
                        row["company_url"] = company_url_for_subdomain(subdomain, cfg)

                for key, value in list(row.items()):
                    if not isinstance(value, str):
                        continue
                    if contains_any_legacy_token(value, legacy_tokens):
                        row[key] = replace_legacy_tokens(value, legacy_token_res)

                writer.writerow(row)


def rewrite_directory(input_dir: Path, output_dir: Path, cfg: RewriteConfig, legacy_tokens: list[str], legacy_token_res: list[re.Pattern[str]]) -> None:
    if not input_dir.is_dir():
        raise SystemExit(f"Input directory not found: {input_dir}")

    output_dir.mkdir(parents=True, exist_ok=True)
    for entry in sorted(input_dir.iterdir()):
        if not entry.is_file():
            continue
        if entry.suffix == ".jsonl":
            rewrite_jsonl_file(entry, output_dir / entry.name, cfg, legacy_tokens, legacy_token_res)
            continue
        if entry.suffix == ".csv":
            rewrite_csv_file(entry, output_dir / entry.name, cfg, legacy_tokens, legacy_token_res)
            continue

        # Unknown file type: copy as-is (best effort).
        (output_dir / entry.name).write_bytes(entry.read_bytes())


def main() -> None:
    parser = argparse.ArgumentParser(description="Rewrite company exports to remove legacy brand strings.")
    parser.add_argument("--input-dir", required=True, help="Directory containing JSONL/CSV exports.")
    parser.add_argument("--output-dir", required=True, help="Directory to write rewritten exports into.")
    parser.add_argument("--site-base-url", default="https://biznesinfo.lucheestiy.com", help="Base site URL for CSV company links.")
    parser.add_argument("--company-path-prefix", default="/company", help="Company path prefix (for source_url + CSV links).")
    parser.add_argument("--catalog-path-prefix", default="/catalog", help="Catalog path prefix for categories/rubrics.")
    args = parser.parse_args()

    cfg = RewriteConfig(
        site_base_url=args.site_base_url,
        company_path_prefix=args.company_path_prefix.rstrip("/"),
        catalog_path_prefix=args.catalog_path_prefix.rstrip("/"),
    )

    legacy_tokens = build_legacy_tokens()
    legacy_token_res = [re.compile(re.escape(token), flags=re.IGNORECASE) for token in legacy_tokens]

    rewrite_directory(Path(args.input_dir), Path(args.output_dir), cfg, legacy_tokens, legacy_token_res)


if __name__ == "__main__":
    main()
