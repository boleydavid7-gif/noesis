import { useState } from 'react'
import { Check } from 'lucide-react'
import { managePlus, perMonth, shortDate, startPlus, usePlus } from './lib/plus'
import type { PlanId } from './workerPlus'
import './plus.css'

/**
 * Noesis Plus: the two plans and what they include, or (with Plus on) the plan, its date and Manage. Shown in the
 * first-visit pages and in Settings. Starting needs an account; without payments set up on the server the prices
 * still show and the button waits.
 */
export function PlusPanel({ onSignIn, onNotice }: { onSignIn: () => void; onNotice: (message: string) => void }) {
  const status = usePlus()
  const [plan, setPlan] = useState<PlanId>('year')
  const [busy, setBusy] = useState(false)
  const use = status.noema

  if (status.plus) {
    const { plus } = status
    return (
      <div className="plus plus-on">
        <div className="plus-head">
          <strong>Noesis Plus</strong>
          <span>
            {plus.plan === 'year' ? 'Yearly' : plus.plan === 'month' ? 'Monthly' : ''}
            {plus.status === 'trialing' ? ' · Free week' : ''}
          </span>
        </div>
        {plus.renews ? (
          <p className="plus-line">
            {plus.endsAtPeriodEnd ? `Ends ${shortDate(plus.renews)}` : `Renews ${shortDate(plus.renews)}`}
          </p>
        ) : null}
        {use ? <Usage used={use.used} limit={use.limit} resets={use.resets} /> : null}
        <button
          type="button"
          className="secondary-button plus-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const problem = await managePlus()
            setBusy(false)
            if (problem) onNotice(problem)
          }}
        >
          Manage subscription
        </button>
      </div>
    )
  }

  const price = status.prices[plan]
  const start = async () => {
    if (!status.signedIn) return onSignIn()
    setBusy(true)
    const problem = await startPlus(plan)
    setBusy(false)
    if (problem) onNotice(problem)
  }
  return (
    <div className="plus">
      <div className="plus-plans" role="radiogroup" aria-label="Plan">
        <PlanChoice
          on={plan === 'year'}
          onPick={() => setPlan('year')}
          name="Yearly"
          price={status.prices.year}
          per="year"
          note={`${perMonth(status.prices.year)} a month`}
        />
        <PlanChoice
          on={plan === 'month'}
          onPick={() => setPlan('month')}
          name="Monthly"
          price={status.prices.month}
          per="month"
        />
      </div>
      <ul className="plus-list">
        <li>
          <Check size={17} aria-hidden="true" />
          <span>
            <strong>Noema, {status.included} questions a month</strong>
            <span>Free: {status.free} a month</span>
          </span>
        </li>
        <li>
          <Check size={17} aria-hidden="true" />
          <span>
            <strong>Review cards from your notes</strong>
          </span>
        </li>
        <li>
          <Check size={17} aria-hidden="true" />
          <span>
            <strong>Rabbit holes with Noema</strong>
          </span>
        </li>
      </ul>
      {use ? <Usage used={use.used} limit={use.limit} resets={use.resets} /> : null}
      <button
        type="button"
        className="primary-button plus-button"
        disabled={busy || (status.signedIn && !status.payments)}
        onClick={() => void start()}
      >
        {!status.signedIn
          ? 'Create an account to start'
          : !status.payments
            ? 'Opens soon'
            : `Try ${status.trialDays} days free`}
      </button>
      <p className="plus-fine">
        Then {price} a {plan}. Cancel in Settings.
      </p>
    </div>
  )
}

function PlanChoice(props: {
  on: boolean
  onPick: () => void
  name: string
  price: string
  per: string
  note?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.on}
      className={props.on ? 'plus-plan plus-plan-on' : 'plus-plan'}
      onClick={props.onPick}
    >
      <span className="plus-plan-name">{props.name}</span>
      <span className="plus-plan-price">
        {props.price}
        <small>/{props.per}</small>
      </span>
      {props.note ? <span className="plus-plan-note">{props.note}</span> : null}
    </button>
  )
}

/** This month's Noema questions as a plain fact and a quiet bar. */
export function Usage({ used, limit, resets }: { used: number; limit: number; resets: string }) {
  const left = Math.max(0, limit - used)
  return (
    <div className="plus-usage">
      <span>
        {left} of {limit} Noema questions left this month
        {left === 0 ? ` · more from ${shortDate(resets)}` : ''}
      </span>
      <span className="plus-meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%` }} />
      </span>
    </div>
  )
}
