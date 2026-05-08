export function Card({ as: Component = 'div', className = '', children, ...props }) {
  return (
    <Component className={`ui-card ${className}`} {...props}>
      {children}
    </Component>
  )
}

export function Button({ as: Component = 'button', variant = 'primary', className = '', children, ...props }) {
  return (
    <Component className={`ui-button ui-button-${variant} ${className}`} {...props}>
      {children}
    </Component>
  )
}

export function Badge({ tone = 'neutral', className = '', children, ...props }) {
  return (
    <span className={`ui-badge ui-badge-${tone} ${className}`} {...props}>
      {children}
    </span>
  )
}

export function SectionHeader({ title, meta, className = '' }) {
  return (
    <div className={`ui-section-header ${className}`}>
      <h2>{title}</h2>
      {meta && <span>{meta}</span>}
    </div>
  )
}

export function EmptyState({ title, description, action, className = '' }) {
  return (
    <div className={`ui-empty-state ${className}`}>
      <p className="ui-empty-title">{title}</p>
      {description && <p className="ui-empty-description">{description}</p>}
      {action}
    </div>
  )
}
