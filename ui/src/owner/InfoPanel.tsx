import { api } from '../api/client.ts';
import type { ConversationDetailDTO } from '../api/types.ts';
import { PersonAvatar } from '../components/Avatar.tsx';
import { IconClose } from '../components/Icons.tsx';
import { fmtBRL, fmtDateTimeEn, humanize } from '../lib/format.ts';

export function InfoPanel({
  detail,
  busy,
  onAction,
  onClose,
}: {
  detail: ConversationDetailDTO;
  busy: boolean;
  onAction: (fn: () => Promise<unknown>) => void;
  onClose: () => void;
}) {
  const c = detail.conversation.contact;
  const name = c.waName || c.phone;
  const profile = Object.entries(c.profile ?? {});
  return (
    <aside className="info-panel" data-testid="owner-info-panel">
      <header className="contact-info-header">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
          <IconClose />
        </button>
        <h2>Contact details</h2>
      </header>
      <div className="contact-info-body">
        <section className="ci-card ci-hero small">
          <PersonAvatar name={name} size={84} />
          <h3>{name}</h3>
          <p className="ci-phone">{c.phone}</p>
          {c.optOut ? <span className="pill pill-closed">Opted out</span> : null}
        </section>
        <section className="ci-card">
          <h4>Profile</h4>
          {profile.length ? (
            <dl className="kv">
              {profile.map(([k, v]) => (
                <div key={k}>
                  <dt>{humanize(k)}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">Nothing learned yet.</p>
          )}
        </section>
        <section className="ci-card">
          <h4>Memory</h4>
          <p className={c.memorySummary ? 'memory' : 'muted'}>{c.memorySummary ?? 'No memory summary yet.'}</p>
        </section>
        <section className="ci-card">
          <h4>Appointments</h4>
          {detail.appointments.length === 0 ? <p className="muted">No appointments.</p> : null}
          <ul className="appt-list">
            {detail.appointments.map((a) => {
              const open = a.status === 'booked' || a.status === 'confirmed';
              return (
                <li key={a.id} className="appt" data-testid={`appointment-${a.id}`}>
                  <div className="appt-top">
                    <span className="appt-service">{a.service}</span>
                    <span className={`pill pill-appt-${a.status}`}>{a.status.replace('_', '-')}</span>
                  </div>
                  <div className="appt-sub">
                    {fmtDateTimeEn(a.startsAt)}
                    {a.staff ? ` · ${a.staff}` : ''}
                    {a.price ? ` · ${fmtBRL(a.price)}` : ''}
                  </div>
                  {open ? (
                    <div className="appt-actions">
                      <button type="button" className="btn-mini" disabled={busy} onClick={() => onAction(() => api.appointmentStatus(a.id, 'done'))}>
                        Done
                      </button>
                      <button type="button" className="btn-mini" disabled={busy} onClick={() => onAction(() => api.appointmentStatus(a.id, 'no_show'))}>
                        No-show
                      </button>
                      <button type="button" className="btn-mini danger" disabled={busy} onClick={() => onAction(() => api.appointmentStatus(a.id, 'cancelled'))}>
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
        <section className="ci-card">
          <h4>Quotes</h4>
          {detail.quotes.length === 0 ? <p className="muted">No quotes.</p> : null}
          {detail.quotes.map((q) => (
            <div key={q.id} className="quote">
              <div className="appt-top">
                <span className="appt-service">Quote #{q.id}</span>
                <span className={`pill pill-quote-${q.status}`}>{q.status}</span>
              </div>
              <ul className="quote-items">
                {q.items.map((it, i) => (
                  <li key={i}>
                    <span>
                      {it.qty > 1 ? `${it.qty}x ` : ''}
                      {it.service}
                    </span>
                    <span>{fmtBRL(it.price * it.qty)}</span>
                  </li>
                ))}
              </ul>
              <div className="quote-total">
                <span>Total</span>
                <span>{fmtBRL(q.total)}</span>
              </div>
            </div>
          ))}
        </section>
      </div>
    </aside>
  );
}
