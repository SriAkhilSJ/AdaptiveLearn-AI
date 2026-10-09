import { useId, type CSSProperties } from 'react'
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react'
import type { VisualExplanation as VisualExplanationData } from '../lib/adaptive'
import './VisualExplanation.css'

interface VisualExplanationProps {
  explanation: VisualExplanationData
}

function VisualNodeCard({
  label,
  details,
  index,
}: {
  label: string
  details: string[]
  index: number
}) {
  return (
    <div className="visual-node-card">
      <span className="visual-node-number" aria-hidden="true">
        {String(index + 1).padStart(2, '0')}
      </span>
      <div className="visual-node-body">
        <h5>{label}</h5>
        {details.length > 0 && (
          <ul>
            {details.map((detail, detailIndex) => (
              <li key={`${detailIndex}-${detail.slice(0, 20)}`}>{detail}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function VisualExplanation({ explanation }: VisualExplanationProps) {
  const headingId = useId()
  const arrowId = `${headingId.replace(/:/g, '')}-cycle-arrow`
  const nodeCount = explanation.items.length

  return (
    <figure
      className={`visual-diagram visual-diagram-${explanation.layout} mx-auto my-0 w-full max-w-3xl rounded-2xl border p-4 sm:p-5`}
      aria-labelledby={headingId}
    >
      <figcaption className="visual-diagram-heading">
        <p className="visual-diagram-kicker">Whole lesson · at a glance</p>
        <h4 className="visual-diagram-title" id={headingId}>{explanation.title}</h4>
        <p className="visual-diagram-summary">{explanation.summary}</p>
      </figcaption>

      {explanation.layout === 'cycle' ? (
        <div className="visual-cycle">
          <svg
            className="visual-cycle-arrows"
            viewBox="0 0 100 100"
            role="presentation"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <marker
                id={arrowId}
                markerWidth="4"
                markerHeight="4"
                refX="3.2"
                refY="2"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L4,2 L0,4 Z" />
              </marker>
            </defs>
            <path d="M50 4 A46 46 0 1 1 42 4" markerEnd={`url(#${arrowId})`} />
          </svg>
          <ol className="visual-cycle-node-list" aria-label="Stages in the repeating cycle">
            {explanation.items.map((item, index) => {
              const angle = (Math.PI * 2 * index) / nodeCount - Math.PI / 2
              const radius = nodeCount > 4 ? 29 : 30
              const left = 50 + Math.cos(angle) * radius
              const top = 50 + Math.sin(angle) * radius
              const position = { left: `${left}%`, top: `${top}%` } satisfies CSSProperties

              return (
                <li className="visual-node visual-cycle-node" key={`${index}-${item.label}`} style={position}>
                  <VisualNodeCard label={item.label} details={item.details} index={index} />
                  {index < nodeCount - 1 ? (
                    <span className="visual-cycle-mobile-connector" aria-hidden="true">
                      <ArrowDown size={18} strokeWidth={2.5} />
                    </span>
                  ) : (
                    <span className="visual-cycle-mobile-return" aria-hidden="true">
                      <ArrowUp size={16} strokeWidth={2.5} />
                      Repeat from <strong>01</strong>
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      ) : (
        <ol
          className={`visual-node-list visual-node-list-${explanation.layout}`}
          aria-label={
            explanation.layout === 'flow'
              ? 'Key ideas in sequence'
              : explanation.layout === 'comparison'
                ? 'Ideas shown side by side'
                : 'Related layers, from top layer down to foundation'
          }
          style={{ '--node-count': nodeCount } as CSSProperties}
        >
          {explanation.items.map((item, index) => {
            const layerWidth = `${68 + (nodeCount > 1 ? (index / (nodeCount - 1)) * 27 : 0)}%`
            const layerStyle = { '--layer-width': layerWidth } as CSSProperties

            return (
              <li
                className={`visual-node${explanation.layout === 'stack' ? ' visual-stack-node' : ''}`}
                key={`${index}-${item.label}`}
                style={explanation.layout === 'stack' ? layerStyle : undefined}
              >
                <VisualNodeCard label={item.label} details={item.details} index={index} />
                {explanation.layout === 'flow' && index < nodeCount - 1 && (
                  <span className="visual-connector" aria-hidden="true">
                    <ArrowRight size={19} strokeWidth={2.5} />
                  </span>
                )}
                {explanation.layout === 'stack' && index < nodeCount - 1 && (
                  <span className="visual-stack-connector" aria-hidden="true">
                    <ArrowDown size={18} strokeWidth={2.5} />
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </figure>
  )
}
