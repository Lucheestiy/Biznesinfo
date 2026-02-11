import type { Metadata } from "next";
import { cache } from "react";
import { redirect } from "next/navigation";

import { companySlugForUrl } from "@/lib/biznesinfo/slug";
import { biznesinfoGetCompany } from "@/lib/biznesinfo/store";
import { buildCompanyShortDescription, getCompanyOgImagePath } from "@/lib/biznesinfo/preview";

import CompanyPageClient from "./CompanyPageClient";

export const runtime = "nodejs";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  process.env.SITE_URL?.trim() ||
  "https://biznesinfo.lucheestiy.com";

const metadataBase = new URL(SITE_URL);

interface PageProps {
  params: Promise<{ id: string }>;
}

const getCompanyForRoute = cache(async (requested: string) => {
  const id = (requested || "").trim();
  if (!id) return null;
  try {
    return await biznesinfoGetCompany(id);
  } catch {
    return null;
  }
});

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

  const data = await getCompanyForRoute(requested);
  if (data) {
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
  }

  return {
    title: "Компания не найдена — Biznesinfo",
    description: "Карточка компании не найдена.",
  };
}

export default async function CompanyPage({ params }: PageProps) {
  const { id } = await params;
  const requested = (id || "").trim();
  const initialData = await getCompanyForRoute(requested);
  const canonicalId = initialData ? companySlugForUrl(initialData.id || requested) : "";
  if (canonicalId && canonicalId !== requested) {
    redirect(`/company/${encodeURIComponent(canonicalId)}`);
  }

  return <CompanyPageClient id={requested} initialData={initialData} />;
}
