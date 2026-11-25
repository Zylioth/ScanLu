import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import ms from '../locales/ms.json'

export const LANG_KEY = 'ohpos.lang'
export type Lang = 'en' | 'ms'

function pickInitial(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'en' || saved === 'ms') return saved
  } catch {
    /* storage blocked */
  }
  return 'en'
}

export async function setupI18n(): Promise<void> {
  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ms: { translation: ms },
    },
    lng: pickInitial(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })
  document.documentElement.lang = i18n.language === 'ms' ? 'ms' : 'en'
}

export function setLanguage(lang: Lang): void {
  void i18n.changeLanguage(lang)
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* storage blocked */
  }
  document.documentElement.lang = lang === 'ms' ? 'ms' : 'en'
}

export default i18n
