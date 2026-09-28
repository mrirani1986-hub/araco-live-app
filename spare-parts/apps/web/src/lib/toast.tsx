import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; text: string }

const Ctx = createContext<(kind: Kind, text: string) => void>(() => {});
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = ++seq;
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  const Icon = { success: CheckCircle2, error: AlertTriangle, info: Info };
  const tone = { success: 'border-emerald-300 bg-emerald-50 text-emerald-900', error: 'border-red-300 bg-red-50 text-red-900', info: 'border-brand-200 bg-white text-slate-800' };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => {
          const I = Icon[t.kind];
          return (
            <div key={t.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${tone[t.kind]}`}>
              <I className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1 break-words">{t.text}</div>
              <button aria-label="Dismiss" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}><X className="h-4 w-4 opacity-60" /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  return {
    success: (t: string) => push('success', t),
    error: (e: unknown) => push('error', e instanceof Error ? e.message : String(e)),
    info: (t: string) => push('info', t),
  };
}
