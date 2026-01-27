import { useLanguage } from "@/contexts/LanguageContext";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  const { t } = useLanguage();

  if (totalPages <= 1) return null;

  const pages: (number | "...")[] = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push("...");
    
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    
    for (let i = start; i <= end; i++) pages.push(i);
    
    if (currentPage < totalPages - 2) pages.push("...");
    
    pages.push(totalPages);
  }

  return (
    <nav className="flex items-center justify-center gap-2 mt-10" aria-label="Pagination">
      {/* Previous button */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
          disabled:opacity-50 disabled:cursor-not-allowed
          bg-gray-100 text-gray-700 hover:bg-gray-200
          active:bg-gray-300"
      >
        ← {t("common.previous") || "Назад"}
      </button>

      {/* Page numbers */}
      {pages.map((page, idx) =>
        page === "..." ? (
          <span key={`ellipsis-${idx}`} className="px-3 py-2 text-gray-400">…</span>
        ) : (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${currentPage === page
                ? "bg-[#820251] text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300"
              }`}
          >
            {page}
          </button>
        )
      )}

      {/* Next button */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
          disabled:opacity-50 disabled:cursor-not-allowed
          bg-gray-100 text-gray-700 hover:bg-gray-200
          active:bg-gray-300"
      >
        {t("common.next") || "Далее"} →
      </button>
    </nav>
  );
}
