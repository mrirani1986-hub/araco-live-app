import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { api, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Modal } from './ui';

/** The signed-in user's signature picture, printed on the PRs they submit or approve. */
export function SignatureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const key = me?.signatureKey ?? null;
  const save = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); await qc.invalidateQueries({ queryKey: ['me'] }); toast.success(msg); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="My signature" footer={<Button onClick={onClose}>Close</Button>}>
      <p className="mb-3 text-sm text-slate-600">
        Your signature is printed on the purchase requisition (PDF) in your box when you submit or approve it. Sign on white paper,
        take a photo or scan, and upload it as PNG or JPG (a PNG with a transparent background looks best).
      </p>
      <div className="mb-3 grid h-32 place-items-center rounded-lg border border-dashed border-slate-300 bg-white">
        {key ? <img src={fileUrl(key)!} alt="Your signature" className="max-h-28 max-w-full object-contain" /> : <span className="text-sm text-slate-400">No signature yet</span>}
      </div>
      <div className="flex gap-2">
        <Button variant="primary" loading={busy} icon={<ImagePlus className="h-4 w-4" />} onClick={() => ref.current?.click()}>{key ? 'Replace' : 'Upload'}</Button>
        {key && <Button loading={busy} icon={<Trash2 className="h-4 w-4" />} onClick={() => save(() => api.del('/auth/signature'), 'Signature removed')}>Remove</Button>}
      </div>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        const fd = new FormData();
        fd.append('file', f);
        void save(() => api.upload('/auth/signature', fd), 'Signature saved');
      }} />
    </Modal>
  );
}
