import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../api/client.ts';
import type { HealthDTO, ReportLinkDTO, TenantDTO, WeeklyMetricsDTO } from '../api/types.ts';
import { KaniLogo } from '../components/KaniLogo.tsx';
import { ThemeToggleButton } from '../components/NavRail.tsx';
import { IconBack, IconChevronDown, IconExternal } from '../components/Icons.tsx';
import { useTheme } from '../lib/theme.ts';
import { navigate, withMock } from '../lib/nav.ts';
import { fmtBRL, fmtDateTimeEn, fmtRelative, TZ } from '../lib/format.ts';
import { setServerNow } from '../lib/clock.ts';

type MetricKey = keyof WeeklyMetricsDTO;

const nf = new Intl.NumberFormat('en-US');
const pct = (n: number) => `${(Math.round(n * 10) / 10).toFixed(n % 1 === 0 ? 0 : 1)}%`;
const weekFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
const clockFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function Kpi({ k, label, value, sub, accent }: { k: MetricKey; label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="kpi" data-testid={`metric-${k}`} style={accent ? ({ '--kpi-accent': accent } as CSSProperties) : undefined}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

function Card({ title, children, testId, extra, className }: { title: string; children: ReactNode; testId?: string; extra?: ReactNode; className?: string }) {
  return (
    <section className={`card${className ? ' ' + className : ''}`} data-testid={testId}>
      <header className="card-head">
        <h2>{title}</h2>
        {extra}
      </header>
      {children}
    </section>
  );
}

function HealthRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="health-row">
      <span className={`health-dot ${ok ? 'ok' : 'bad'}`} aria-hidden="true" />
      <span className="health-label">{label}</span>
      <span className={`health-status ${ok ? 'ok' : 'bad'}`}>{ok ? 'OK' : 'Down'}</span>
      {detail ? <span className="health-detail">{detail}</span> : null}
    </li>
  );
}

export function AdminPage() {
  const theme = useTheme();
  const [tenants, setTenants] = useState<TenantDTO[]>([]);
  const [tenantFilter, setTenantFilter] = useState('all');
  const [metrics, setMetrics] = useState<WeeklyMetricsDTO | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportLinkDTO[] | null>(null);
  const [health, setHealth] = useState<HealthDTO | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [clockBase, setClockBase] = useState<{ server: number; local: number; offset: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [ttBusy, setTtBusy] = useState(false);
  const [ttResult, setTtResult] = useState<string | null>(null);
  const filterRef = useRef(tenantFilter);
  filterRef.current = tenantFilter;

  useEffect(() => {
    document.title = 'Kani Admin';
    return () => {
      document.title = 'Kani';
    };
  }, []);

  const loadMetrics = useCallback(async () => {
    const f = filterRef.current;
    try {
      const m = await api.metrics(f);
      if (filterRef.current === f) {
        setMetrics(m);
        setMetricsError(null);
      }
    } catch (err) {
      setMetricsError(String(err));
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const h = await api.health();
      setHealth(h);
      setHealthError(false);
      setServerNow(h.now);
      setClockBase({ server: Date.parse(h.now), local: Date.now(), offset: h.offsetHours });
    } catch {
      setHealthError(true);
    }
  }, []);

  useEffect(() => {
    api.tenants().then(setTenants, () => setTenants([]));
    api.reports().then(setReports, () => setReports([]));
    void loadHealth();
    const t = window.setInterval(() => void loadHealth(), 30_000);
    const m = window.setInterval(() => void loadMetrics(), 30_000);
    const s = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(m);
      window.clearInterval(s);
    };
  }, [loadHealth, loadMetrics]);

  useEffect(() => {
    void loadMetrics();
  }, [tenantFilter, loadMetrics]);

  useEffect(
    () =>
      api.subscribe((e) => {
        if (e.type === 'clock') {
          setServerNow(e.now);
          setClockBase({ server: Date.parse(e.now), local: Date.now(), offset: e.offsetHours });
        }
      }),
    [],
  );

  async function travel(hours: number) {
    setTtBusy(true);
    setTtResult(null);
    try {
      const r = await api.timeTravel(hours);
      setServerNow(r.now);
      setClockBase({ server: Date.parse(r.now), local: Date.now(), offset: r.offsetHours });
      setTtResult(`Advanced ${hours}h. ${r.fired} scheduled job${r.fired === 1 ? '' : 's'} fired.`);
      void loadMetrics();
    } catch (err) {
      setTtResult(`Time travel failed: ${String(err)}`);
    } finally {
      setTtBusy(false);
    }
  }

  void tick;
  const clockNow = clockBase ? new Date(clockBase.server + (Date.now() - clockBase.local)) : null;
  const m = metrics;
  const maxReason = m ? Math.max(1, ...m.escalations.byReason.map((r) => r.count)) : 1;
  const maxQuestion = m ? Math.max(1, ...m.topQuestions.map((q) => q.count)) : 1;

  return (
    <div className="admin" data-testid="admin-page" lang="en">
      <header className="admin-header">
        <div className="admin-brand">
          <KaniLogo size={36} />
          <div>
            <h1>Kani Admin</h1>
            <p>
              Weekly results
              {m ? ` · ${weekFmt.format(new Date(m.weekStart))} to ${weekFmt.format(new Date(m.weekEnd))}` : ''}
            </p>
          </div>
        </div>
        <div className="admin-controls">
          <label className="select-wrap admin-select">
            <select data-testid="admin-tenant-select" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)} aria-label="Tenant">
              <option value="all">All tenants</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <IconChevronDown size={18} />
          </label>
          <a
            className="btn-outline"
            href={withMock('/')}
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            <IconBack size={18} /> Simulator
          </a>
          <ThemeToggleButton mode={theme.mode} cycle={theme.cycle} className="icon-btn bordered" />
        </div>
      </header>

      <main className="admin-main">
        {metricsError && !m ? <div className="admin-error">Could not load metrics. Is the server running?</div> : null}

        <section className="kpi-grid">
          {m ? (
            <>
              <Kpi k="conversationsHandled" label="Conversations handled" value={nf.format(m.conversationsHandled)} sub="by Kani this week" />
              <Kpi
                k="answeredUnder1MinPct"
                label="Answered under 1 min"
                value={pct(m.answeredUnder1MinPct)}
                sub={<span className="meter"><span style={{ width: `${Math.min(100, m.answeredUnder1MinPct)}%` }} /></span>}
              />
              <Kpi k="afterHoursLeads" label="After-hours leads captured" value={nf.format(m.afterHoursLeads)} sub="messages outside opening hours" />
              <Kpi k="bookingsCreated" label="Bookings created" value={nf.format(m.bookingsCreated)} sub="appointments booked by the bot" />
              <Kpi
                k="remindersSent"
                label="Reminders sent"
                value={nf.format(m.remindersSent)}
                sub={
                  <span>
                    <b data-testid="metric-reminderConfirmationRate">{pct(m.reminderConfirmationRate)}</b> confirmed
                  </span>
                }
              />
              <Kpi k="noShowsAvoided" label="No-shows avoided" value={nf.format(m.noShowsAvoided)} sub="confirmed or rescheduled after a reminder" />
              <Kpi
                k="quotesSent"
                label="Quotes sent / approved"
                value={
                  <span>
                    {nf.format(m.quotesSent)} <span className="kpi-slash">/</span> <span data-testid="metric-quotesApproved">{nf.format(m.quotesApproved)}</span>
                  </span>
                }
                sub={
                  <span>
                    <b data-testid="metric-quotesApprovedValue">{fmtBRL(m.quotesApprovedValue)}</b> approved of {fmtBRL(m.quotesSentValue)}
                  </span>
                }
              />
              <Kpi k="reactivatedCustomers" label="Reactivated customers" value={nf.format(m.reactivatedCustomers)} sub="came back after a win-back message" />
              <Kpi k="attributedRevenue" label="Attributed booked revenue" value={fmtBRL(m.attributedRevenue)} sub="bookings and approved quotes" accent="var(--brand)" />
            </>
          ) : (
            Array.from({ length: 9 }, (_, i) => <div key={i} className="kpi skeleton" />)
          )}
        </section>

        <div className="admin-row two">
          <Card title="Escalations" testId="metric-escalations" extra={m ? <span className="card-count">{m.escalations.total} total</span> : null}>
            {m ? (
              <>
                <ul className="hbars">
                  {m.escalations.byReason.map((r) => (
                    <li key={r.reason} title={`${r.reason}: ${r.count}`}>
                      <span className="hbar-label">{r.reason}</span>
                      <span className="hbar-track">
                        <span className="hbar-fill esc" style={{ width: `${(r.count / maxReason) * 100}%` }} />
                      </span>
                      <span className="hbar-value">{r.count}</span>
                    </li>
                  ))}
                  {m.escalations.byReason.length === 0 ? <li className="muted">No escalations this week.</li> : null}
                </ul>
                {m.escalations.recent.length ? (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Tenant</th>
                          <th>Reason</th>
                          <th>When</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.escalations.recent.map((e) => (
                          <tr key={e.id}>
                            <td>{e.tenantName}</td>
                            <td>{e.reason}</td>
                            <td title={fmtDateTimeEn(e.createdAt)}>{fmtRelative(e.createdAt)}</td>
                            <td>
                              <span className={`pill ${e.resolved ? 'pill-bot' : 'pill-esc'}`}>{e.resolved ? 'Resolved' : 'Open'}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="skeleton block" />
            )}
          </Card>
          <Card title="Top 5 questions">
            {m ? (
              <ol className="ranked">
                {m.topQuestions.slice(0, 5).map((q, i) => (
                  <li key={q.question} title={`${q.question}: ${q.count}`}>
                    <span className="rank">{i + 1}</span>
                    <span className="ranked-main">
                      <span className="ranked-q">{q.question}</span>
                      <span className="hbar-track thin">
                        <span className="hbar-fill" style={{ width: `${(q.count / maxQuestion) * 100}%` }} />
                      </span>
                    </span>
                    <span className="hbar-value">{q.count}</span>
                  </li>
                ))}
                {m.topQuestions.length === 0 ? <li className="muted">No questions yet.</li> : null}
              </ol>
            ) : (
              <div className="skeleton block" />
            )}
          </Card>
        </div>

        <Card title="Per tenant">
          <div className="table-wrap">
            <table className="table" data-testid="per-tenant-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th className="num">Conversations</th>
                  <th className="num">Bookings</th>
                  <th className="num">Escalations</th>
                  <th className="num">Attributed revenue</th>
                </tr>
              </thead>
              <tbody>
                {m?.perTenant.map((r) => {
                  const t = tenants.find((x) => x.id === r.tenantId);
                  return (
                    <tr key={r.tenantId}>
                      <td>
                        <span className="tenant-cell">
                          {t ? (
                            <span className="mini-avatar" style={{ background: t.avatarColor }}>
                              {t.emoji}
                            </span>
                          ) : null}
                          {r.tenantName}
                        </span>
                      </td>
                      <td className="num">{nf.format(r.conversationsHandled)}</td>
                      <td className="num">{nf.format(r.bookingsCreated)}</td>
                      <td className="num">{nf.format(r.escalations)}</td>
                      <td className="num">{fmtBRL(r.attributedRevenue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="admin-row two">
          <Card title="Scenario reports" testId="admin-reports">
            {reports === null ? <div className="skeleton block" /> : null}
            {reports && reports.length === 0 ? <p className="muted">No reports yet. Run the scenario suite to generate one.</p> : null}
            <ul className="reports">
              {reports?.map((r) => (
                <li key={r.file} className="report">
                  <span className={`pill pill-kind-${r.kind}`}>{r.kind}</span>
                  <span className="report-main">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="report-link">
                      {r.model ?? r.file}
                      <IconExternal size={14} />
                    </a>
                    <span className="report-sub">{fmtDateTimeEn(r.createdAt)}</span>
                  </span>
                  {r.summary ? (
                    <span className="report-score">
                      <span>
                        <b>{r.summary.avgScore.toFixed(1)}</b> avg score
                      </span>
                      <span className={`pass ${r.summary.passed === r.summary.total ? 'all' : ''}`}>
                        {r.summary.passed}/{r.summary.total} passed
                      </span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Dev tools" testId="admin-dev-tools">
            <div className="clock">
              <div className="clock-label">Server clock (São Paulo)</div>
              <div className="clock-value" data-testid="server-clock">
                {clockNow ? clockFmt.format(clockNow) : healthError ? 'unavailable' : '...'}
              </div>
              <div className="clock-offset">
                Offset: <b>{clockBase ? `${clockBase.offset >= 0 ? '+' : ''}${clockBase.offset}h` : '0h'}</b>
              </div>
            </div>
            <div className="tt-buttons">
              <button type="button" className="btn-outline" data-testid="time-travel-1h" disabled={ttBusy} onClick={() => void travel(1)}>
                +1h
              </button>
              <button type="button" className="btn-primary" data-testid="time-travel-24h" disabled={ttBusy} onClick={() => void travel(24)}>
                +24h
              </button>
            </div>
            {ttResult ? <p className="tt-result">{ttResult}</p> : null}
            <h3 className="subhead">System health</h3>
            <ul className="health">
              {health ? (
                <>
                  <HealthRow ok={health.ok} label="API server" />
                  <HealthRow ok={health.ollama.ok} label="Ollama" detail={health.ollama.models.join(', ') || health.ollama.url} />
                  <HealthRow ok={health.whisperx.ok} label="whisperX" detail={health.whisperx.bin ?? 'not found'} />
                  <li className="health-models">
                    <span>Chat model</span>
                    <code>{health.model}</code>
                    <span>Alt model</span>
                    <code>{health.altModel}</code>
                    <span>Vision model</span>
                    <code>{health.visionModel}</code>
                  </li>
                </>
              ) : healthError ? (
                <HealthRow ok={false} label="API server" detail="not reachable" />
              ) : (
                <li className="muted">Checking...</li>
              )}
            </ul>
          </Card>
        </div>
      </main>
    </div>
  );
}
