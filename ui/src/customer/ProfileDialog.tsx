import { useState } from 'react';
import type { CustomerIdentity } from '../lib/storage.ts';
import { PersonAvatar } from '../components/Avatar.tsx';
import { IconBack } from '../components/Icons.tsx';

/** Slide-over profile editor (like the profile drawer of the left panel). */
export function ProfileDialog({ customer, onClose, onSave }: { customer: CustomerIdentity; onClose: () => void; onSave: (c: CustomerIdentity) => void }) {
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const valid = name.trim().length > 0 && phone.replace(/\D/g, '').length >= 10;
  return (
    <div className="drawer" role="dialog" aria-label="Meu perfil" data-testid="profile-drawer">
      <header className="drawer-header">
        <button type="button" className="icon-btn light" onClick={onClose} aria-label="Voltar">
          <IconBack />
        </button>
        <h2>Meu perfil</h2>
      </header>
      <div className="drawer-body">
        <div className="drawer-avatar">
          <PersonAvatar name={name || '?'} size={160} />
        </div>
        <form
          className="profile-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSave({ name: name.trim(), phone: phone.trim() });
          }}
        >
          <label className="field">
            <span className="field-label">Seu nome</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} data-testid="profile-name" />
          </label>
          <p className="field-help">Este nome aparece para a empresa quando você envia mensagens.</p>
          <label className="field">
            <span className="field-label">Telefone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={24} data-testid="profile-phone" />
          </label>
          <p className="field-help">Trocar o telefone inicia conversas novas com todas as empresas.</p>
          <div className="profile-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={!valid} data-testid="profile-save">
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
