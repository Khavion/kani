import { useEffect, useState } from 'react';
import type { TenantDTO } from '../api/types.ts';
import { IconClose, IconSend } from '../components/Icons.tsx';

export function ImagePreview({ file, tenant, onClose, onSend }: { file: File; tenant: TenantDTO; onClose: () => void; onSend: (caption: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="img-preview" role="dialog" aria-label="Enviar imagem" data-testid="image-preview">
      <header className="img-preview-header">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Cancelar">
          <IconClose />
        </button>
        <span className="img-preview-name">{file.name}</span>
      </header>
      <div className="img-preview-stage">
        {url ? <img src={url} alt="Pré-visualização" /> : null}
      </div>
      <form
        className="img-preview-footer"
        onSubmit={(e) => {
          e.preventDefault();
          onSend(caption.trim());
        }}
      >
        <input
          className="img-preview-caption"
          placeholder="Adicione uma legenda"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          autoFocus
          data-testid="image-preview-caption"
        />
        <div className="img-preview-send-row">
          <span className="img-preview-to">{tenant.name}</span>
          <button type="submit" className="send-fab" aria-label="Enviar" data-testid="image-preview-send">
            <IconSend size={26} />
          </button>
        </div>
      </form>
    </div>
  );
}
