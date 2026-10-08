import type { ReactNode } from 'react'

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch${checked ? ' switch-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

export function Row({ title, detail, children }: { title: string; detail?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        {detail ? <p>{detail}</p> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? 'segmented-on' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Group({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="setting-group panel-card">
      <h3>
        {icon} {title}
      </h3>
      {children}
    </section>
  )
}
