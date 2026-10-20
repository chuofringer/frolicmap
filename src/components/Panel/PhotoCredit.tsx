import { useTranslation } from 'react-i18next'
import { parsePhotoCredit, splitLicence } from '@/utils/photoCredit'

const LINK_PROPS = { target: '_blank', rel: 'noopener noreferrer' } as const

/**
 * Photo credit overlay text. CC BY / CC BY-SA ask for a link to the source
 * and the licence, so when the stored attribution carries them (see
 * `parsePhotoCredit`) the licence name links to the licence and a "Commons"
 * link goes to the file page. Old plain-text attributions render as before.
 */
export function PhotoCredit({ attribution }: { attribution: string }) {
  const { t } = useTranslation()
  const { text, sourceUrl, licenceUrl } = parsePhotoCredit(attribution)
  if (!sourceUrl && !licenceUrl) return <>{t('detail.photoAttribution', { attribution: text })}</>

  const { before, licence } = splitLicence(text)
  const linkClass = 'underline underline-offset-2'
  return (
    <>
      {t('detail.photoLabel')}{' '}
      {licence && licenceUrl ? (
        <>
          {before} (<a href={licenceUrl} {...LINK_PROPS} className={linkClass}>{licence}</a>)
        </>
      ) : (
        text
      )}
      {sourceUrl && (
        <>
          {' · '}
          <a href={sourceUrl} {...LINK_PROPS} className={linkClass}>{t('detail.photoCommons')}</a>
        </>
      )}
    </>
  )
}
