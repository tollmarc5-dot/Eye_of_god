import type { SchemaIssue } from '@/data'
import type { LoadStage } from '@/state/store'
import { HudButton } from '@/ui/primitives'

const STAGES: readonly { readonly stage: LoadStage; readonly label: string }[] = [
  { stage: 'fetching', label: 'Graph core online' },
  { stage: 'adapting', label: 'Loading knowledge structure' },
  { stage: 'layout', label: 'Mapping the world' },
]

/** First line of the message only: stack traces never reach the user. */
function firstLine(message: string): string {
  return message.split('\n')[0] ?? message
}

export function LoadingScreen({ stage }: { readonly stage: LoadStage | null }) {
  const activeIndex = STAGES.findIndex((entry) => entry.stage === stage)
  return (
    <div className="eog-overlay">
      <div className="eog-boot" role="status" aria-live="polite">
        <p className="eog-boot__title">System initializing</p>
        <div className="eog-boot__bar" aria-hidden="true" />
        <ul className="eog-boot__steps">
          {STAGES.map((entry, index) => {
            const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending'
            return (
              <li key={entry.stage} className="eog-boot__step" data-state={state}>
                <span aria-hidden="true">{state === 'done' ? '■' : state === 'active' ? '▸' : '·'}</span>
                {entry.label}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

interface ErrorScreenProps {
  readonly message: string
  readonly issues: readonly SchemaIssue[]
  readonly onRetry: () => void
}

export function ErrorScreen({ message, issues, onRetry }: ErrorScreenProps) {
  return (
    <div className="eog-overlay">
      <div className="eog-panel eog-boot eog-boot--error" role="alert">
        <p className="eog-boot__title">Graph core error</p>
        <p className="eog-boot__message">{firstLine(message)}</p>
        {issues.length > 0 && (
          <ul className="eog-boot__issues eog-mono">
            {issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                {issue.path} — {issue.message} ({issue.count}×)
              </li>
            ))}
          </ul>
        )}
        <div>
          <HudButton label="Load the graph again" tooltipAlign="start" onClick={onRetry}>
            Retry
          </HudButton>
        </div>
      </div>
    </div>
  )
}
