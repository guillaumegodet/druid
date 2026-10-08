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
    const uais = new Set();
    data.records.forEach(r => {
      // V2: the `participations` field (uai-XXXX[role][dates]) replaces `tutelles`
      const t = r.fields.participations || '';
      t.split('|').forEach(u => {
        const trimmed = u.split('[')[0].trim().replace(/^uai-/i, '');
        if (trimmed) uais.add(trimmed);
      });
    });
    console.log("UAIs in Grist:", Array.from(uais));
    
    // Read UAI.txt and match
    const uaiText = fs.readFileSync(path.join(ROOT, 'scripts/refdata/UAI.txt'), 'utf8');
    const uaiLines = uaiText.split('\n');
    const mapping = {};
    uaiLines.forEach(line => {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        mapping[parts[0].trim()] = parts[1].trim();
      }
    });
    
    const finalMapping = {};
    uais.forEach(u => {
      finalMapping[u] = mapping[u] || u;
    });
    
    console.log("MAPPING:", finalMapping);
    
    const tsCode = `export const UAI_MAPPING: Record<string, string> = ${JSON.stringify(mapping, null, 2)};\n\nexport const getTutelleName = (uai: string): string => {\n  return UAI_MAPPING[uai.toUpperCase()] || uai;\n};\n`;
    fs.writeFileSync(path.join(ROOT, 'lib/uaiMapping.ts'), tsCode);
    console.log("Updated lib/uaiMapping.ts");
  } catch(e) {
    console.error("ERROR", e);
  }
}
run();
