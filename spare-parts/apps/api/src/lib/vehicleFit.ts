/**
 * Does a DT catalogue part fit a truck? Reads the catalogue's "Suitable for" text, e.g.
 * "TGA/TGS/TGX", "TGM (N48), TGA/TGS/TGX", "TGA (H76)" (only MAN type code H76), "D 2866, D 2876" (engines), "Universal".
 */
export type Fit = 'FITS' | 'CHECK_ENGINE' | 'OTHER_MODEL' | 'UNKNOWN';
export interface Vehicle { vehicleSeries: string | null; typeCode: string | null; engine: string | null }

const SERIES_RE = /TG[LMASX]/g;
const engineNumbers = (s: string) => {
  const out = new Set<string>();
  for (const m of s.matchAll(/D\s?(\d{4})((?:\/\d{4})*)/g)) {
    out.add(m[1]);
    for (const n of m[2].split('/').filter(Boolean)) out.add(n);
  }
  return out;
};

export function vehicleFit(suitable: string | null | undefined, v: Vehicle): { fit: Fit; reason: string } {
  const text = (suitable ?? '').toUpperCase().replace(/TGU/g, 'TGL'); // OCR reads "TGL/" as "TGU"
  if (!text.trim()) return { fit: 'UNKNOWN', reason: 'The catalogue gives no model' };
  if (/UNIVERSAL/.test(text)) return { fit: 'FITS', reason: 'Universal part' };
  const series = v.vehicleSeries?.toUpperCase();
  const segments = text.split(',').map((s) => s.trim());
  const named = segments.filter((s) => s.match(SERIES_RE));
  if (named.length && series) {
    for (const seg of named) {
      const ss: string[] = seg.match(SERIES_RE) ?? [];
      if (!ss.includes(series)) continue;
      const codes = [...seg.matchAll(/\(([^)]*)\)/g)].flatMap((m) => m[1].split(/[\s/]+/)).filter(Boolean);
      if (codes.length && ss.length === 1) {
        if (v.typeCode && codes.includes(v.typeCode.toUpperCase())) return { fit: 'FITS', reason: `${series} type ${v.typeCode}` };
        if (!v.typeCode) return { fit: 'UNKNOWN', reason: `Only ${series} type ${codes.join('/')}; set the truck's type code` };
        continue;
      }
      return { fit: 'FITS', reason: `For ${seg}` };
    }
    return { fit: 'OTHER_MODEL', reason: `For ${named.join(', ')}` };
  }
  if (named.length) return { fit: 'UNKNOWN', reason: 'Set the truck model series' };
  const engines = engineNumbers(text);
  if (engines.size) {
    const list = [...engines].map((n) => `D ${n}`).join(', ');
    const mine = v.engine?.match(/(\d{4})/)?.[1];
    if (!mine) return { fit: 'CHECK_ENGINE', reason: `Engine ${list}; set the truck's engine` };
    return engines.has(mine) ? { fit: 'FITS', reason: `Engine D ${mine}` } : { fit: 'OTHER_MODEL', reason: `Engine ${list}` };
  }
  return { fit: 'UNKNOWN', reason: `Catalogue text: ${suitable}` };
}
