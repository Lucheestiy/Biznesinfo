 "use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";

interface AIAssistantProps {
  floating?: boolean;
  companyName?: string;
  companyId?: string;
  isActive?: boolean;
  hideFloatingButton?: boolean;
}

export default function AIAssistant({
  floating = false,
  companyName,
  companyId,
  isActive = true,
  hideFloatingButton = false,
}: AIAssistantProps) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [senderCompanyName, setSenderCompanyName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [position, setPosition] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<{
    senderCompanyName?: string;
    contactPerson?: string;
    position?: string;
    phone?: string;
    message?: string;
  }>({});

  useEffect(() => {
    if (!floating || typeof window === "undefined") return;
    const handleEvent = () => {
      setErrors({});
      setIsOpen(true);
    };
    window.addEventListener("aiassistant:open", handleEvent);
    return () => {
      window.removeEventListener("aiassistant:open", handleEvent);
    };
  }, [floating]);

  const validate = () => {
    const nextErrors: typeof errors = {};
    const required = t("ai.form.required") || "Это поле обязательно";

    if (!senderCompanyName.trim()) nextErrors.senderCompanyName = required;
    if (!contactPerson.trim()) nextErrors.contactPerson = required;
    if (!position.trim()) nextErrors.position = required;

    const phoneTrimmed = phone.trim();
    if (!phoneTrimmed) {
      nextErrors.phone = required;
    } else {
      const digits = phoneTrimmed.replace(/\D/g, "");
      if (digits.length < 7) {
        nextErrors.phone = t("ai.form.phoneInvalid") || "Введите корректный номер телефона";
      }
    }

    if (!message.trim()) nextErrors.message = required;

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    // Here would be the API call to send the request to AI
    console.log("AI Request:", {
      senderCompanyName,
      contactPerson,
      position,
      phone,
      message,
      companyName,
      companyId,
    });
    setSubmitted(true);
    setMessage("");
    setErrors({});

    setTimeout(() => {
      setSubmitted(false);
      setIsOpen(false);
    }, 3000);
  };

  // Floating button on main page
  if (floating) {
    return (
    <>
      {/* Floating button */}
      {!hideFloatingButton && (
        <button
          onClick={() => {
            setErrors({});
            setIsOpen(true);
          }}
          className="fixed bottom-6 right-6 bg-gradient-to-r from-[#820251] to-[#5a0138] text-white px-6 py-4 rounded-full shadow-2xl hover:shadow-3xl transition-all hover:scale-105 flex items-center gap-3 z-40"
        >
          <div className="w-10 h-10 bg-yellow-400 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-[#820251]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <span className="font-bold text-lg">{t("ai.title")}</span>
        </button>
      )}

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="bg-gradient-to-r from-[#820251] to-[#5a0138] text-white p-6 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-yellow-400 rounded-full flex items-center justify-center">
                    <svg className="w-7 h-7 text-[#820251]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{t("ai.title")}</h2>
                    <p className="text-sm text-pink-200">{t("ai.personalAssistant")}</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-white/80 hover:text-white"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6">
              {submitted ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-gray-800 mb-2">{t("ai.requestSent")}</h3>
                  <p className="text-gray-600">{t("ai.requestProcessing")}</p>
                </div>
              ) : (
                <>
                  <p className="text-gray-600 mb-4">{t("ai.description")}</p>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="flex justify-end">
                      <Link
                        href="/cabinet"
                        className="text-sm text-[#820251] hover:underline"
                      >
                        {t("ai.form.login") || "Войти в личный кабинет"}
                      </Link>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t("ai.form.senderCompanyName") || "Название вашей компании"} *
                        </label>
                        <input
                          type="text"
                          value={senderCompanyName}
                          onChange={(e) => {
                            setSenderCompanyName(e.target.value);
                            if (errors.senderCompanyName) setErrors((prev) => ({ ...prev, senderCompanyName: undefined }));
                          }}
                          className={`w-full p-3 border rounded-lg focus:outline-none focus:border-[#820251] ${
                            errors.senderCompanyName ? "border-red-400" : "border-gray-200"
                          }`}
                          placeholder="ООО «Ваша компания»"
                          autoComplete="organization"
                        />
                        {errors.senderCompanyName && (
                          <p className="mt-1 text-sm text-red-600">{errors.senderCompanyName}</p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t("ai.form.contactPerson") || "Контактное лицо (ФИО)"} *
                        </label>
                        <input
                          type="text"
                          value={contactPerson}
                          onChange={(e) => {
                            setContactPerson(e.target.value);
                            if (errors.contactPerson) setErrors((prev) => ({ ...prev, contactPerson: undefined }));
                          }}
                          className={`w-full p-3 border rounded-lg focus:outline-none focus:border-[#820251] ${
                            errors.contactPerson ? "border-red-400" : "border-gray-200"
                          }`}
                          placeholder="Иванов Иван Иванович"
                          autoComplete="name"
                        />
                        {errors.contactPerson && (
                          <p className="mt-1 text-sm text-red-600">{errors.contactPerson}</p>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {t("ai.form.position") || "Должность"} *
                          </label>
                          <input
                            type="text"
                            value={position}
                            onChange={(e) => {
                              setPosition(e.target.value);
                              if (errors.position) setErrors((prev) => ({ ...prev, position: undefined }));
                            }}
                            className={`w-full p-3 border rounded-lg focus:outline-none focus:border-[#820251] ${
                              errors.position ? "border-red-400" : "border-gray-200"
                            }`}
                            placeholder="Менеджер"
                            autoComplete="organization-title"
                          />
                          {errors.position && (
                            <p className="mt-1 text-sm text-red-600">{errors.position}</p>
                          )}
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {t("ai.form.phone") || "Личный номер телефона"} *
                          </label>
                          <input
                            type="tel"
                            inputMode="tel"
                            value={phone}
                            onChange={(e) => {
                              setPhone(e.target.value);
                              if (errors.phone) setErrors((prev) => ({ ...prev, phone: undefined }));
                            }}
                            className={`w-full p-3 border rounded-lg focus:outline-none focus:border-[#820251] ${
                              errors.phone ? "border-red-400" : "border-gray-200"
                            }`}
                            placeholder="+375 29 000-00-00"
                            autoComplete="tel"
                          />
                          {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone}</p>}
                        </div>
                      </div>
                    </div>

                    <div>
                      <textarea
                        value={message}
                        onChange={(e) => {
                          setMessage(e.target.value);
                          if (errors.message) setErrors((prev) => ({ ...prev, message: undefined }));
                        }}
                        placeholder={t("ai.placeholder")}
                        className={`w-full p-4 border rounded-lg focus:outline-none focus:border-[#820251] resize-none h-32 ${
                          errors.message ? "border-red-400" : "border-gray-200"
                        }`}
                      />
                      {errors.message && <p className="mt-1 text-sm text-red-600">{errors.message}</p>}
                    </div>
                    <button
                      type="submit"
                      className="w-full mt-4 bg-[#820251] text-white py-3 rounded-lg font-semibold hover:bg-[#6a0143] transition-colors"
                    >
                      {t("ai.sendRequest")}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
    );
  }

  // Button in company card - inactive state (no highlight, muted appearance)
  if (!isActive) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed border border-gray-200"
        title={t("ai.inactive")}
      >
        <svg className="w-5 h-5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <span className="text-sm font-normal">{t("ai.title")}</span>
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => {
          setErrors({});
          setIsOpen(true);
        }}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#820251] to-[#5a0138] text-white rounded-lg hover:opacity-90 transition-opacity"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <span className="text-sm font-medium">{t("ai.title")}</span>
      </button>

      {/* Modal for company-specific AI */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="bg-gradient-to-r from-[#820251] to-[#5a0138] text-white p-6 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">{t("ai.title")}</h2>
                  {companyName && (
                    <p className="text-sm text-pink-200">{t("ai.requestTo")} {companyName}</p>
                  )}
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-white/80 hover:text-white"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6">
              {submitted ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-gray-800 mb-2">{t("ai.prioritySent")}</h3>
                  <p className="text-gray-600">{t("ai.priorityDesc")}</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="flex justify-end">
                    <Link
                      href="/cabinet"
                      className="text-sm text-[#820251] hover:underline"
                    >
                      {t("ai.form.login") || "Войти в личный кабинет"}
                    </Link>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("ai.form.senderCompanyName") || "Название вашей компании"} *
                      </label>
                      <input
                        type="text"
                        value={senderCompanyName}
                        onChange={(e) => {
                          setSenderCompanyName(e.target.value);
                          if (errors.senderCompanyName) setErrors((prev) => ({ ...prev, senderCompanyName: undefined }));
                        }}
                        className={`w-full p-3 border rounded-lg focus:outline-none focus:border-[#820251] ${
                          errors.senderCompanyName ? "border-red-400" : "border-gray-200"
                        }`}
                        placeholder="ООО «Ваша компания»"
                        autoComplete="organization"
                      />
                      {errors.senderCompanyName && (
                        <p className="mt-1 text-sm text-red-600">{errors.senderCompanyName}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("ai.form.contactPerson") || "Контактное лицо (ФИО)"} *
                      </label>
                      <input
                        type="text"
                        value={contactPerson}
                        onChange={(e) => {
                          setContactPerson(e.target.value);
                          if (errors.contactPerson) setErrors((prev) => ({ ...prev, contactPerson: undefined }));
                        }}
                        className={`w-full p-3 border rounded-lg focus:outline-none focus:border-[#820251] ${
                          errors.contactPerson ? "border-red-400" : "border-gray-200"
                        }`}
                        placeholder="Иванов Иван Иванович"
                        autoComplete="name"
                      />
                      {errors.contactPerson && (
                        <p className="mt-1 text-sm text-red-600">{errors.contactPerson}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t("ai.form.position") || "Должность"} *
                        </label>
                        <input
                          type="text"
                          value={position}
                          onChange={(e) => {
                            setPosition(e.target.value);
                            if (errors.position) setErrors((prev) => ({ ...prev, position: undefined }));
                          }}
                          className={`w-full p-3 border rounded-lg focus:outline-none focus:border-[#820251] ${
                            errors.position ? "border-red-400" : "border-gray-200"
                          }`}
                          placeholder="Менеджер"
                          autoComplete="organization-title"
                        />
                        {errors.position && (
                          <p className="mt-1 text-sm text-red-600">{errors.position}</p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t("ai.form.phone") || "Личный номер телефона"} *
                        </label>
                        <input
                          type="tel"
                          inputMode="tel"
                          value={phone}
                          onChange={(e) => {
                            setPhone(e.target.value);
                            if (errors.phone) setErrors((prev) => ({ ...prev, phone: undefined }));
                          }}
                          className={`w-full p-3 border rounded-lg focus:outline-none focus:border-[#820251] ${
                            errors.phone ? "border-red-400" : "border-gray-200"
                          }`}
                          placeholder="+375 29 000-00-00"
                          autoComplete="tel"
                        />
                        {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone}</p>}
                      </div>
                    </div>
                  </div>

                  <div>
                    <textarea
                      value={message}
                      onChange={(e) => {
                        setMessage(e.target.value);
                        if (errors.message) setErrors((prev) => ({ ...prev, message: undefined }));
                      }}
                      placeholder={t("ai.describePlaceholder")}
                      className={`w-full p-4 border rounded-lg focus:outline-none focus:border-[#820251] resize-none h-32 ${
                        errors.message ? "border-red-400" : "border-gray-200"
                      }`}
                    />
                    {errors.message && <p className="mt-1 text-sm text-red-600">{errors.message}</p>}
                  </div>
                  <button
                    type="submit"
                    className="w-full mt-4 bg-[#820251] text-white py-3 rounded-lg font-semibold hover:bg-[#6a0143] transition-colors"
                  >
                    {t("ai.sendRequest")}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
