import { IconBookOpen } from '../components/Icons'

const keyRules = [
  'All future claims should be submitted through the RH Finance Claims App.',
  "Claims should be submitted within 3 working days once all receipts and bank transactions for the event are ready.",
  'Physical receipts must be submitted to Ryan after uploading the claim. Exact handover timing and location will be advised by Finance when confirmed.',
  'Receipt-specific instructions may change. Check Help > Common Questions before submitting.',
]

const setupSteps = [
  'Open Telegram and go to @rhfinance68_bot.',
  'Send /start.',
  'Tap Open Claims App.',
  'Register as a CCA Treasurer.',
  'Fill in your full name, NUS email, matric number, phone number, Telegram username, and CCA.',
  'Submit the registration and wait for Finance to approve your account.',
  'Once approved, create and track claims through the app.',
]

const claimEvidence = [
  ['Receipt / invoice', 'Required for every item. Details must be clear and complete.'],
  ['Bank transaction', 'Required for online payments and card payments, including physical purchases paid by Visa, Mastercard, or another card.'],
  ['Refund evidence', 'Required if any item was refunded or partially refunded.'],
  ['Foreign exchange screenshot', 'Required for overseas or foreign-currency purchases.'],
  ['Master Fund approval', 'Required for Master Fund claims.'],
  ['Transport details', 'Required for transport claims where route or trip details are needed.'],
  ['Additional claimer emails', 'Add the email of anyone else whose receipt is included, especially if they paid and you are submitting on their behalf.'],
]

const statuses = [
  ['Draft', 'Claim has not been submitted. Continue editing and upload missing documents.'],
  ['In Review', 'Finance is checking the receipts, bank transactions, categories, and supporting documents.'],
  ['Needs Action', 'Finance has returned the claim or requested corrections. Read the feedback and resubmit after fixing.'],
  ['Awaiting Submission', 'Finance has approved the claim and sent the confirmation email or instructions.'],
  ['Submitted', 'The claim has been submitted for school or office processing.'],
  ['Reimbursed', 'Payment has been made to the relevant payee. Check that the transfer was received.'],
]

const quotationNotes = [
  'Use the quotation or direct vendor payment process when the hall is expected to pay the vendor directly.',
  'Purchases of $1,500 or more should go through the quotation process unless Finance advises otherwise.',
  'Keep the Finance Director in the email chain for quotation matters.',
  'Obtain the required approvals before committing to the transaction.',
  'Check billing details before sending quotations or invoices. Incorrect billing details may cause rejection.',
]

const otherProcesses = [
  {
    title: 'NUSync / official payment collection',
    body: 'Used when there is official student co-payment or payment collection. Inform the Finance Director early so the correct process and timeline can be confirmed.',
  },
  {
    title: 'Coaches forms',
    body: 'Sports and Culture Directors are primarily responsible for coaches matters, but treasurers should ensure contracts, timesheets, signatures, and approved amounts are in order before payment is expected.',
  },
  {
    title: 'Help tab',
    body: 'Use the Help tab to streamline enquiries, ask claim questions, report app issues, and clarify unclear requirements. Common questions may be added to the Help list for future reference.',
  },
]

function Section({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  )
}

function BulletList({ items }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-sm leading-relaxed text-gray-700">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function NumberedList({ items }) {
  return (
    <ol className="space-y-2">
      {items.map((item, index) => (
        <li key={item} className="flex gap-3 text-sm leading-relaxed text-gray-700">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-700">
            {index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  )
}

function InfoRows({ rows }) {
  return (
    <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
      {rows.map(([label, body]) => (
        <div key={label} className="p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
          <p className="mt-1 text-sm leading-relaxed text-gray-700">{body}</p>
        </div>
      ))}
    </div>
  )
}

export default function SopPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-10">
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
        <div className="flex items-start gap-3">
          <IconBookOpen className="mt-0.5 h-6 w-6 shrink-0 text-blue-600" />
          <div>
            <h1 className="text-base font-semibold text-gray-900">Finance SOP</h1>
            <p className="mt-1 text-sm leading-relaxed text-gray-700">
              Reference guide for CCA treasurers submitting claims and finance requests.
              Receipt instructions that may change are kept in Help &gt; Common Questions.
            </p>
          </div>
        </div>
      </div>

      <Section title="Key Rules">
        <BulletList items={keyRules} />
      </Section>

      <Section title="Claims App Setup">
        <NumberedList items={setupSteps} />
      </Section>

      <Section title="Claim Evidence Checklist">
        <InfoRows rows={claimEvidence} />
      </Section>

      <Section title="Claim Statuses">
        <InfoRows rows={statuses} />
      </Section>

      <Section title="Quotations and Direct Vendor Payments">
        <BulletList items={quotationNotes} />
      </Section>

      <Section title="Other Finance Processes">
        <div className="space-y-3">
          {otherProcesses.map((item) => (
            <div key={item.title} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <p className="text-sm font-semibold text-gray-800">{item.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="When Unsure">
        <p className="text-sm leading-relaxed text-gray-700">
          If you are unsure whether a receipt, transaction, funding source, or supporting document is acceptable,
          please PM Ryan or ask through the Help tab before submitting. It is better to clarify early than to submit
          an incomplete or unsupported claim, as claims may be returned or rejected if the requirements are not met.
        </p>
      </Section>
    </div>
  )
}
