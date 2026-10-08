import { ArrowDown } from 'lucide-react'
import type { VisualExplanation as VisualExplanationData } from '../lib/adaptive'
import './VisualExplanation.css'

interface VisualExplanationProps {
  explanation: VisualExplanationData
}

export function VisualExplanation({ explanation }: VisualExplanationProps) {
  return (
    <div
      className={`visual-diagram visual-diagram-${explanation.layout}`}
      role="group"
      aria-label={`${explanation.title} diagram`}
    >
      <h4 className="visual-diagram-title">{explanation.title}</h4>
      <ol className="visual-node-list">
        {explanation.items.map((item, index) => (
          <li className="visual-node" key={`${index}-${item.label}`}>
            <div className="visual-node-card">
              <span className="visual-node-number" aria-hidden="true">{index + 1}</span>
              <div className="visual-node-body">
                <h5>{item.label}</h5>
                {item.details.length > 0 && (
                  <ul>
                    {item.details.map((detail, detailIndex) => (
                      <li key={`${detailIndex}-${detail.slice(0, 20)}`}>{detail}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {explanation.layout !== 'comparison' && index < explanation.items.length - 1 && (
              <span className="visual-connector" aria-hidden="true">
                <ArrowDown size={19} />
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
