import type { TenantDTO } from '../api/types.ts';
import { TenantAvatar } from '../components/Avatar.tsx';
import { IconClose } from '../components/Icons.tsx';
import { fmtBRL } from '../lib/format.ts';

const DAYS: [keyof TenantDTO['hours'], string][] = [
  ['seg', 'Segunda'],
  ['ter', 'Terça'],
  ['qua', 'Quarta'],
  ['qui', 'Quinta'],
  ['sex', 'Sexta'],
  ['sab', 'Sábado'],
  ['dom', 'Domingo'],
];

export function ContactInfo({ tenant, onClose }: { tenant: TenantDTO; onClose: () => void }) {
  return (
    <aside className="contact-info" data-testid="contact-info">
      <header className="contact-info-header">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
          <IconClose />
        </button>
        <h2>Dados do contato</h2>
      </header>
      <div className="contact-info-body">
        <section className="ci-card ci-hero">
          <TenantAvatar tenant={tenant} size={200} />
          <h3>{tenant.name}</h3>
          <p className="ci-phone">{tenant.phone}</p>
          <p className="ci-sub">Conta comercial · {tenant.packName}</p>
        </section>
        <section className="ci-card">
          <h4>Endereço</h4>
          <p>{tenant.address}</p>
        </section>
        <section className="ci-card">
          <h4>Horário de funcionamento</h4>
          <ul className="ci-hours">
            {DAYS.map(([k, label]) => {
              const h = tenant.hours?.[k];
              return (
                <li key={k}>
                  <span>{label}</span>
                  <span>{h ? `${h[0]} às ${h[1]}` : 'Fechado'}</span>
                </li>
              );
            })}
          </ul>
        </section>
        {tenant.services?.length ? (
          <section className="ci-card">
            <h4>Serviços</h4>
            <ul className="ci-services">
              {tenant.services.map((s) => (
                <li key={s.n}>
                  <span>{s.n}</span>
                  <span className="ci-price">{s.p > 0 ? fmtBRL(s.p) : 'Sob consulta'}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {tenant.staff?.length ? (
          <section className="ci-card">
            <h4>Equipe</h4>
            <ul className="ci-services">
              {tenant.staff.map((s) => (
                <li key={s.name}>
                  <span>{s.name}</span>
                  <span className="ci-price">{s.role}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
