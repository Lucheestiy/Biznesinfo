"use client";

import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import AIAssistant from "./AIAssistant";

interface MessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyName: string;
  companyId: string;
  email?: string;
  phone?: string;
  hasAI?: boolean;
}

type Channel = "ai" | "email" | "viber" | "telegram" | "whatsapp";

export default function MessageModal({
  isOpen,
  onClose,
  companyName,
  companyId,
  email,
  phone,
  hasAI = false,
}: MessageModalProps) {
  const { t } = useLanguage();
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  if (!isOpen) return null;

  const channels: { id: Channel; name: string; icon: string; available: boolean; color: string }[] = [
    { id: "ai", name: t("ai.title"), icon: "AI", available: hasAI, color: "bg-gradient-to-r from-[#820251] to-[#5a0138]" },
    { id: "email", name: "Email", icon: "✉️", available: !!email, color: "bg-blue-500" },
    { id: "viber", name: "Viber", icon: "📱", available: !!phone, color: "bg-purple-500" },
    { id: "telegram", name: "Telegram", icon: "✈️", available: !!phone, color: "bg-sky-500" },
    { id: "whatsapp", name: "WhatsApp", icon: "📞", available: !!phone, color: "bg-green-500" },
  ];

  const handleSend = () => {
    if (!message.trim() || !selectedChannel) return;

    // Format message with company info
    const formattedMessage = `Запрос в компанию: ${companyName}\n\n${message}`;

    switch (selectedChannel) {
      case "email":
        window.location.href = `mailto:${email}?subject=Запрос от BiznesInfo&body=${encodeURIComponent(formattedMessage)}`;
        break;
      case "viber":
        window.open(`viber://chat?number=${phone?.replace(/[^0-9+]/g, "")}`, "_blank");
        break;
      case "telegram":
        window.open(`https://t.me/share/url?text=${encodeURIComponent(formattedMessage)}`, "_blank");
        break;
      case "whatsapp":
        window.open(`https://wa.me/${phone?.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(formattedMessage)}`, "_blank");
        break;
      case "ai":
        // AI handled separately
        break;
    }

    setSent(true);
    setTimeout(() => {
      setSent(false);
      onClose();
      setSelectedChannel(null);
      setMessage("");
    }, 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#820251] to-[#5a0138] text-white p-6 rounded-t-2xl sticky top-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">{t("message.title")}</h2>
              <p className="text-sm text-pink-200">{companyName}</p>
            </div>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6">
          {sent ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-800">Сообщение отправлено!</h3>
            </div>
          ) : (
            <>
              {/* Channel selection */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  {t("message.selectChannel")}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {channels.map((channel) => (
                    <button
                      key={channel.id}
                      onClick={() => channel.available && setSelectedChannel(channel.id)}
                      disabled={!channel.available}
                      className={`p-4 rounded-lg border-2 transition-all flex items-center gap-3 ${
                        selectedChannel === channel.id
                          ? "border-[#820251] bg-[#820251]/5"
                          : channel.available
                          ? "border-gray-200 hover:border-gray-300"
                          : "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <div className={`w-10 h-10 ${channel.color} rounded-full flex items-center justify-center text-white text-lg`}>
                        {channel.icon}
                      </div>
                      <span className={`font-medium ${channel.available ? "text-gray-700" : "text-gray-400"}`}>
                        {channel.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Message input */}
              {selectedChannel && selectedChannel !== "ai" && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t("message.yourMessage")}
                    </label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Введите ваше сообщение..."
                      className="w-full p-4 border border-gray-200 rounded-lg focus:outline-none focus:border-[#820251] resize-none h-32"
                    />
                  </div>

                  <button
                    onClick={handleSend}
                    disabled={!message.trim()}
                    className="w-full bg-[#820251] text-white py-3 rounded-lg font-semibold hover:bg-[#6a0143] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t("message.send")}
                  </button>
                </>
              )}

              {/* AI Assistant integrated */}
              {selectedChannel === "ai" && hasAI && (
                <div className="mt-4">
                  <AIAssistant companyName={companyName} companyId={companyId} isActive={true} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
