import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GRIST_DOC_ID = 'qzzYmeoVSwbYGWhqw2kYZz';
const GRIST_API_KEY = process.env.GRIST_API_KEY || process.env.VITE_GRIST_API_KEY; // read from .env (never hard-coded)

async function run() {
  try {
    const res = await fetch(`http://localhost:3000/api/grist/docs/${GRIST_DOC_ID}/tables/Structures/columns`, {
      headers: { 'Authorization': `Bearer ${GRIST_API_KEY}` }
    });
    const data = await res.json();
    fs.writeFileSync(path.join(ROOT, 'grist_structures_columns.json'), JSON.stringify(data.columns.map(c => ({id: c.id, label: c.fields.label})), null, 2));
    console.log("JSON written");
  } catch(e) {
    console.error("ERROR", e);
  }
}
run();
