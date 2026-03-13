"use client";

import { useRef, useState } from "react";

export default function PasswordField({
  id = "password",
  name = "password",
  required = true,
  autoComplete = "current-password",
}: {
  id?: string;
  name?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const clearPassword = () => {
    setValue("");
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 pr-20 focus:outline-none focus:ring-2 focus:ring-[#a0006d]/30"
      />

      <div className="absolute inset-y-0 right-2 flex items-center gap-1">
        {value.length > 0 && (
          <button
            type="button"
            onClick={clearPassword}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Очистить пароль"
            title="Очистить пароль"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
          title={visible ? "Скрыть пароль" : "Показать пароль"}
        >
          {visible ? (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
              <path d="M3 3l18 18" strokeLinecap="round" strokeLinejoin="round" />
              <path
                d="M10.58 10.58a2 2 0 102.84 2.84M9.88 4.24A10.94 10.94 0 0112 4c5 0 9.27 3.11 11 7.5a11.83 11.83 0 01-4.22 5.33M6.61 6.61A11.83 11.83 0 001 11.5C2.73 15.89 7 19 12 19a10.94 10.94 0 004.24-.88"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
              <path
                d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
