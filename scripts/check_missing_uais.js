import fs from 'fs';
import { UAI_MAPPING } from './lib/uaiMapping.js';

const GRIST_DOC_ID = 'qzzYmeoVSwbYGWhqw2kYZz';
const GRIST_API_KEY = process.env.GRIST_API_KEY || process.env.VITE_GRIST_API_KEY; // read from .env (never hard-coded)

async function run() {
  try {
    const res = await fetch(`http://localhost:3000/api/grist/docs/${GRIST_DOC_ID}/tables/Structures/records`, {
      headers: { 'Authorization': `Bearer ${GRIST_API_KEY}` }
    });
    const data = await res.json();
    const missing = new Set();
    data.records.forEach(r => {
      // V2: the `participations` field (uai-XXXX[role][dates]) replaces `tutelles`
      const t = r.fields.participations || '';
      t.split('|').forEach(u => {
        const trimmed = u.split('[')[0].trim().replace(/^uai-/i, '').toUpperCase();
        if (trimmed && !UAI_MAPPING[trimmed]) {
          missing.add(trimmed);
        }
      });
    });
    console.log("Missing UAIs:", Array.from(missing));
  } catch(e) {
    console.error("ERROR", e);
  }
}
run();
