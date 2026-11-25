import { useTranslation } from 'react-i18next'
import { LANG_KEY, setLanguage, type Lang } from '../lib/i18n'
import { cx } from './ui'

export function LanguageToggle({ className }: { className?: string }) {
  const { i18n, t } = useTranslation()
  const current: Lang = i18n.language === 'ms' ? 'ms' : 'en'

  return (
    <div
      role="group"
      aria-label={t('common.language')}
      className={cx('flex items-center rounded-full border border-hairline bg-panel p-0.5', className)}
    >
      {(['en', 'ms'] as Lang[]).map((lang) => {
        const active = current === lang
        return (
          <button
            key={lang}
            type="button"
            aria-pressed={active}
            onClick={() => {
              setLanguage(lang)
              try {
                localStorage.setItem(LANG_KEY, lang)
              } catch {
                /* storage blocked */
              }
            }}
            className={cx(
              'min-h-9 rounded-full px-2.5 text-xs font-semibold transition-colors',
              active ? 'bg-brand-700 text-cream-50' : 'text-ink-muted hover:text-ink',
            )}
          >
            {lang === 'en' ? 'EN' : 'BM'}
          </button>
        )
      })}
    </div>
  )
}
