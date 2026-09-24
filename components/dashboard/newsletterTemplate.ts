// HTML rendering of the « L'Actu Recherche » newsletter — `Nantes Université` brand:
// black #000000 (primary), blue #3452ff (secondary), gray #f1f2f6
// (complementary); cards with hook + short summary + original title + DOI.
// The HTML is self-contained (inline styles): ready to paste into a mail client
// or to send as is.

export interface NewsletterArticle {
  accroche: string;
  resume: string;
  titre: string;
  doi: string;
  /** Featured researcher (Centrale staff member matched in the directory). */
  chercheur?: {
    nom: string;
    photo?: string;
    url?: string;
    labo?: string;
  } | null;
}

const esc = (s: string) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Researcher block: round photo + name (+ lab), as a table for mail-client
// compatibility. Without a photo: Centrale-blue badge with the initial.
const researcherBlock = (c: NonNullable<NewsletterArticle['chercheur']>) => {
  const initial = esc((c.nom || '?').trim().charAt(0).toUpperCase());
  const avatar = c.photo
    ? `<img src="${esc(c.photo)}" alt="${esc(c.nom)}" width="44" height="44" style="width:44px;height:44px;border-radius:50%;object-fit:cover;display:block;" />`
    : `<div style="width:44px;height:44px;border-radius:50%;background:#000000;color:#ffffff;font-weight:800;font-size:18px;text-align:center;line-height:44px;">${initial}</div>`;
  const name = c.url
    ? `<a href="${esc(c.url)}" target="_blank" style="color:#3452ff;text-decoration:none;font-weight:600;">${esc(c.nom)}</a>`
    : `<span style="color:#3452ff;font-weight:600;">${esc(c.nom)}</span>`;
  return `
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom: 12px;"><tr>
                <td style="vertical-align: middle;">${avatar}</td>
                <td style="vertical-align: middle; padding-left: 10px; font-size: 13px;">
                    ${name}${c.labo ? `<br><span style="color:#888; font-size: 12px;">${esc(c.labo)}</span>` : ''}
                </td>
            </tr></table>`;
};

const articleCard = (a: NewsletterArticle) => `
        <div class="article-card">
            <p class="summary">${esc(a.accroche)}</p>
            <p style="font-size: 14px; color: #555; margin-bottom: 15px;">${esc(a.resume)}</p>
${a.chercheur && a.chercheur.nom ? researcherBlock(a.chercheur) : ''}
            <p class="original-title">Titre original : ${esc(a.titre)}</p>
            ${a.doi ? `<a href="https://doi.org/${esc(a.doi)}" target="_blank" class="btn">Lire la publication</a>` : ''}
        </div>`;

export function renderNewsletter(opts: {
  articles: NewsletterArticle[];
  structName: string;
  /** Footer line, e.g. « Laboratoires : LHEEA, LS2N, GeM, AAU, LMJL. » */
  footerLine?: string;
  /** Editable intro, e.g. « Bonjour ! Voici un aperçu grand public… » */
  intro?: string;
}): string {
  const { articles, structName } = opts;
  const intro =
    opts.intro ||
    'Bonjour ! Voici un aperçu grand public des travaux publiés par nos laboratoires ce mois-ci :';
  const footer =
    opts.footerLine || `${structName} © ${new Date().getFullYear()}.`;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(structName)} - Actu Recherche</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Inter', sans-serif; background-color: #f1f2f6; color: #333; margin: 0; padding: 0; line-height: 1.6; }
        .email-container { max-width: 650px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.08); }
        .header { background-color: #000000; color: #ffffff; padding: 30px 40px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.5px; }
        .header p { margin: 10px 0 0 0; font-size: 14px; color: #8ea0ff; }
        .content { padding: 40px; }
        .intro { font-size: 16px; margin-bottom: 30px; color: #555; }
        .article-card { background: #f1f2f6; border-left: 4px solid #3452ff; padding: 20px 25px; margin-bottom: 25px; border-radius: 4px; }
        .summary { font-size: 16px; font-weight: 600; color: #000000; margin-top: 0; margin-bottom: 10px; }
        .original-title { font-size: 12px; color: #888; margin-bottom: 15px; font-style: italic; }
        .btn { display: inline-block; background-color: #3452ff; color: #ffffff !important; text-decoration: none; padding: 8px 16px; font-size: 12px; font-weight: 600; border-radius: 6px; }
        .footer { background-color: #f1f2f6; padding: 20px; text-align: center; font-size: 12px; color: #777; }
    </style>
</head>
<body>

<div class="email-container">
    <div class="header">
        <h1>L'Actu Recherche 🔬</h1>
        <p>Les dernières découvertes de ${esc(structName)} vulgarisées pour vous</p>
    </div>

    <div class="content">
        <p class="intro">${esc(intro)}</p>
${articles.map(articleCard).join('\n')}
    </div>

    <div class="footer">
        ${esc(footer)}
    </div>
</div>

</body>
</html>
`;
}
