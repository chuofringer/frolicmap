import type { AnchorHTMLAttributes } from 'react'
import { useNavigate, type NavigateOptions } from 'react-router-dom'
import { localizedPath } from '@/i18n/locale'
import { isPlainLeftClick } from '@/utils/plainLeftClick'

interface InAppLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** App-absolute, UNPREFIXED path (`/cities/seattle`). */
  to: string
  /** Router navigation state (e.g. where the visitor came from). */
  state?: NavigateOptions['state']
}

/**
 * An `<a>` that keeps a real, localised `href` (middle-click, open in a new
 * tab, copy link, crawlers) but moves between in-app routes with react-router
 * on a plain left click, so the map never reloads and the prerendered
 * crawler fallback is never shown to someone already inside the app.
 *
 * `to` is deliberately passed to `navigate` WITHOUT the locale prefix: the
 * router's basename (`/zh`) is prepended for us, so a localised path there
 * would become `/zh/zh/...`. Only the `href` carries the prefix.
 */
export function InAppLink({ to, state, onClick, children, ...rest }: InAppLinkProps) {
  const navigate = useNavigate()
  return (
    <a
      {...rest}
      href={localizedPath(to)}
      onClick={(e) => {
        onClick?.(e)
        if (!isPlainLeftClick(e) || rest.target === '_blank') return
        e.preventDefault()
        navigate(to, { state })
      }}
    >
      {children}
    </a>
  )
}
