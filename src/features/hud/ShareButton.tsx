import { useEffect, useId, useRef, useState } from 'react'
import { currentViewUrl } from '@/state/url-sync'
import { CloseIcon, LinkIcon } from '@/ui/icons'
import { HudButton } from '@/ui/primitives'

type ShareState =
  | { readonly status: 'idle' }
  | { readonly status: 'copied' }
  /** The clipboard is not available: the link is shown so it can be copied by hand. */
  | { readonly status: 'manual'; readonly url: string }

const FEEDBACK_MS = 2500

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Denied permission or an insecure context: the caller falls back to showing the link.
    return false
  }
}

/**
 * Copies a link to the current view. The link is the address bar's own
 * contract (see url-state): nothing but ids and switches.
 */
export function ShareButton() {
  const [state, setState] = useState<ShareState>({ status: 'idle' })
  const fieldRef = useRef<HTMLInputElement>(null)
  const fieldId = useId()

  useEffect(() => {
    if (state.status !== 'copied') return
    const timer = setTimeout(() => setState({ status: 'idle' }), FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [state])

  // The fallback field arrives selected, ready for Ctrl/Cmd + C.
  useEffect(() => {
    if (state.status === 'manual') fieldRef.current?.select()
  }, [state])

  const share = async (): Promise<void> => {
    const url = currentViewUrl()
    setState((await copyToClipboard(url)) ? { status: 'copied' } : { status: 'manual', url })
  }

  return (
    <div className="eog-share">
      <HudButton
        label={state.status === 'copied' ? 'Link copied' : 'Copy link to this view'}
        tooltipSide="bottom"
        tooltipAlign="end"
        onClick={() => void share()}
      >
        <LinkIcon />
        <span className="eog-share__text">{state.status === 'copied' ? 'Copied' : 'Share'}</span>
      </HudButton>
      {/* Text, not colour, carries the result; announced to assistive technology. */}
      <span className="eog-sr-only" role="status">
        {state.status === 'copied' && 'Link copied to the clipboard'}
        {state.status === 'manual' && 'Could not copy automatically. The link is shown so you can copy it.'}
      </span>
      {state.status === 'manual' && (
        <div className="eog-share__fallback" role="group" aria-label="Link to this view">
          <label className="eog-label" htmlFor={fieldId}>
            Copy this link
          </label>
          <input
            id={fieldId}
            ref={fieldRef}
            className="eog-share__field"
            type="text"
            readOnly
            value={state.url}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              setState({ status: 'idle' })
            }}
          />
          <button
            type="button"
            className="eog-chip__clear"
            aria-label="Close the link"
            onClick={() => setState({ status: 'idle' })}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
