// Dev helper: renders a document to /tmp for visual checks. Usage: tsx src/pdf/render-check.ts po 1
import fs from 'node:fs';
import { poPdf, prPdf, grnPdf, partPdf } from './documents.js';
import { closePdfBrowser } from './render.js';

const [kind, id] = process.argv.slice(2);
const fn = { po: poPdf, pr: prPdf, grn: grnPdf, part: partPdf }[kind as 'po'];
const out = `/tmp/${kind}-${id}.pdf`;
fs.writeFileSync(out, await fn(Number(id)));
await closePdfBrowser();
console.log(out);
process.exit(0);
