import { useState, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { truncateAtWordBoundary } from '@/lib/truncate'

interface ErrorMessageProps {
  error: string
  maxLength?: number
  action?: ReactNode
}

/**
 * Displays an error message with optional expand/collapse for long text.
 * Messages longer than 100 characters are truncated at word boundaries
 * with a "Show more" button to reveal the full error.
 */
export function ErrorMessage({ error, maxLength = 100, action }: ErrorMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const isTruncated = error.length > maxLength
  const displayText = isExpanded ? error : truncateAtWordBoundary(error, maxLength)

  return (
    <div className="flex flex-col gap-1 w-full">
      <p className="group text-sm text-destructive flex items-start gap-1 whitespace-pre-wrap">
        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
        <span className="min-w-0 flex-1">
          {displayText}
          {action ? <span className="inline-flex align-middle ml-1">{action}</span> : null}
        </span>
      </p>
      {isTruncated && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
          aria-label={isExpanded ? 'Show less error details' : 'Show more error details'}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
