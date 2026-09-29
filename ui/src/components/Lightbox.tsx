import { useEffect } from 'react';
import { IconClose } from './Icons.tsx';

export function Lightbox({ src, caption, onClose, title }: { src: string; caption?: string | null; onClose: () => void; title?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose} data-testid="lightbox">
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-title">{title}</span>
        <button type="button" className="icon-btn light" onClick={onClose} aria-label="Fechar">
          <IconClose />
        </button>
      </div>
      <img className="lightbox-img" src={src} alt={caption ?? ''} onClick={(e) => e.stopPropagation()} />
      {caption ? <div className="lightbox-caption">{caption}</div> : null}
    </div>
  );
}
