import type { Metadata } from "next";

import { companySlugForUrl } from "@/lib/biznesinfo/slug";
import { biznesinfoGetCompany } from "@/lib/biznesinfo/store";
import { buildCompanyShortDescription, getCompanyOgImagePath } from "@/lib/biznesinfo/preview";

import CompanyPageClient from "./CompanyPageClient";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  process.env.SITE_URL?.trim() ||
  "https://biznesinfo.lucheestiy.com";

const metadataBase = new URL(SITE_URL);

interface PageProps {
  params: Promise<{ id: string }>;
}

function toAbsoluteUrl(value: string): string {
  const raw = (value || "").trim();
  if (!raw) return metadataBase.toString();
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return new URL(raw.startsWith("/") ? raw : `/${raw}`, metadataBase).toString();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const requested = (id || "").trim();

  if (!requested) {
    return {
      title: "Компания не найдена — Biznesinfo",
      description: "Карточка компании не найдена.",
    };
  }

  try {
    const data = await biznesinfoGetCompany(requested);
    const company = data.company;
    const title = (company.name || "").trim() || "Компания";
    const description = buildCompanyShortDescription(company);

    const canonicalId = companySlugForUrl(data.id || requested);
    const canonicalPath = `/company/${encodeURIComponent(canonicalId)}`;
    const canonicalUrl = new URL(canonicalPath, metadataBase);

    const imagePath = getCompanyOgImagePath(company) || "/opengraph-image";
    const imageUrl = toAbsoluteUrl(imagePath);

    return {
      title,
      description,
      alternates: {
        canonical: canonicalUrl,
      },
      openGraph: {
        title,
        description,
        url: canonicalUrl,
        type: "website",
        images: [
          {
            url: imageUrl,
            width: 1200,
            height: 630,
            alt: title,
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [imageUrl],
      },
    };
  } catch {
    return {
      title: "Компания не найдена — Biznesinfo",
      description: "Карточка компании не найдена.",
    };
  }
}

export default async function CompanyPage({ params }: PageProps) {
  const { id } = await params;
  const requested = (id || "").trim();

  let initialData = null;
  if (requested) {
    try {
      initialData = await biznesinfoGetCompany(requested);
    } catch {
      initialData = null;
    }
  }

  return <CompanyPageClient id={requested} initialData={initialData} />;
}

