"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";

import { DEFAULT_LANGUAGE, DICTIONARIES, LANGUAGES, type Dictionary, type Language } from "./dictionaries";

const STORAGE_KEY = "framemind-language";
const CHANGE_EVENT = "framemind-language-change";

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language.id === value);
}

// The chosen language lives in localStorage so it survives reloads.
function readLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function setLanguage(language: Language) {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Storage blocked (private mode): the choice still applies until reload.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

type I18nValue = {
  language: Language;
  /** BCP 47 locale for date formatting, e.g. "vi-VN". */
  locale: string;
  t: Dictionary;
  setLanguage: (language: Language) => void;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Pages are prerendered in the default language; the stored choice is applied right after hydration.
  const language = useSyncExternalStore(subscribe, readLanguage, () => DEFAULT_LANGUAGE);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value: I18nValue = {
    language,
    locale: LANGUAGES.find((l) => l.id === language)!.locale,
    t: DICTIONARIES[language],
    setLanguage,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}
