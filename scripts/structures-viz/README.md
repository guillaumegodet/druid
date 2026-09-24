# structures-viz — visualisation hiérarchie structures

Outil **vendoré** depuis le dépôt des collègues
[`CRISalid-esr/crisalid-directory-bridge`](https://github.com/CRISalid-esr/crisalid-directory-bridge)
(branche `master`, dossier `.claude/commands/`). Voir la doc :
<https://crisalid-esr.github.io/crisalid-deployment/directories/structures.html#tooling-for-csv-files>

Génère un HTML **autonome** (Cytoscape.js + dagre, chargés via CDN unpkg) montrant la
hiérarchie d'un `structures.csv` : arêtes pleines = inclusions (composition forte),
arêtes pointillées = participations (tutelles / appartenances faibles).

## Fichiers
- `visualize_structures.py` — script (stdlib pure, aucun pip).
- `structures-visualization.html` — template HTML compagnon (requis, lu via `Path(__file__).with_name(...)`).
- `refdata/` — référentiels UAI/ROR. **Stubs vides** (header seul) volontaires : ils existent
  pour que `_download_if_missing` / `_ensure_ror_csv` voient un fichier présent et **n'aillent
  PAS télécharger** le CSV UAI ni le **zip ROR (très lourd)** au runtime. Conséquence : les
  institutions externes sont étiquetées par leur code (ou via `UAI_FALLBACK`, qui contient CNRS) ;
  la hiérarchie interne — l'essentiel — vient intégralement du `structures.csv`.

## Seule modification vs amont
Une ligne : `DATA_DIR` pointe sur `refdata/` à côté du script (amont :
`Path(__file__).parent.parent.parent / 'data'`). Pour resynchroniser : recopier les 2 fichiers
amont et ré-appliquer ce patch d'une ligne.

## Usage (identique à l'amont)
```
python3 visualize_structures.py <csv> [output.html] [--root-institution LOCAL_ID]
```

Exposé dans Druid via l'endpoint `GET /api/structures-hierarchy.html` (server.cjs), lancé sur
`/cdb-data/structures.csv`, affiché dans l'onglet **Dataviz** de la page Structures.

## Prérequis image
`python3` est installé dans l'étage de production du `Dockerfile`.
