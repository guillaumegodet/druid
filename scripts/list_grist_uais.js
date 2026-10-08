import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GRIST_DOC_ID = process.env.VITE_GRIST_DOC_ID || 'qzzYmeoVSwbYGWhqw2kYZz';
const GRIST_API_KEY = process.env.GRIST_API_KEY || process.env.VITE_GRIST_API_KEY; // read from .env (never hard-coded)

async function run() {
  try {
    const res = await fetch(`https://grist.numerique.gouv.fr/api/docs/${GRIST_DOC_ID}/tables/Structures/records`, {
      headers: { 'Authorization': `Bearer ${GRIST_API_KEY}` }
    });
    const data = await res.json();
    const allUais = new Set();
    data.records.forEach(r => {
      // V2: the `participations` field (uai-XXXX[role][dates]) replaces `tutelles`
      const t = r.fields.participations || '';
      t.split('|').forEach(u => {
        const trimmed = u.split('[')[0].trim().replace(/^uai-/i, '').toUpperCase();
        if (trimmed) allUais.add(trimmed);
      });
    });
    const uais = Array.from(allUais);
    fs.writeFileSync(path.join(ROOT, 'grist_uais.json'), JSON.stringify(uais, null, 2));
    console.log("Written grist_uais.json");
  } catch(e) {
    console.error("ERROR", e);
  }
}
run();
