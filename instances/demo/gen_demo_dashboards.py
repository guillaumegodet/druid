#!/usr/bin/env python3
"""Fictitious bibliometric dashboards of the fictitious instances (demo, demo-2).

docs/plan-instance-demo-cloudflare.md, lot A4. The demo runs on Cloudflare Pages without the
druid-biblio backend: /api/dashboard/:slug/publications does not exist and the frontend reads
the static exports of public/dashboard-data/ (lib/dashboardSource.ts), copied there from
instances/demo/dashboard-data/ by scripts/prepare-cloudflare-assets.cjs.

Writes, for the university (udemo, union of the labs) and each lab (lira, bios, lmd):
  dashboard-data/<slug>/dashboard.json  same contract as the druid-biblio export
  dashboard-data/<slug>/news.json       « Veille » tab (static fallback of /api/news/:slug)
and dashboard-data/index.json (structures) and dashboard-data/mentions.json (« Médias » panel).

Members and authors come from the researchers of the demo Grist doc (demo-data.mjs), so the
dashboards name the same people as the directory. Everything is fictitious (titles, journals,
DOIs under the 10.5555 test prefix, partners, funders, media). Seeded: a rebuild changes nothing.

Usage (no node on the host: the researchers are exported by a node container):
  docker run --rm -v "$PWD":/app -w /app node:20-slim node instances/demo/demo-data.mjs > /tmp/demo-people.json
  python3 instances/demo/gen_demo_dashboards.py /tmp/demo-people.json
The second demo (docs/plan-architecture-multi-instances.md, lot 6) has its own universe (UNIVERSES):
  docker run --rm -v "$PWD":/app -w /app node:20-slim node instances/demo-2/demo-data.mjs > /tmp/demo-2-people.json
  python3 instances/demo/gen_demo_dashboards.py --instance demo-2 /tmp/demo-2-people.json
It writes instances/<instance>/dashboard-data/.
Adapted from scripts/gen_demo_dashboards.py of the former demo fork (guillaumegodet/Druid).
"""
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
COUNTRY_NAMES = json.load(open(os.path.join(HERE, "country_names.json"), encoding="utf-8"))

# ── Vocabulary: the aggregators map exact strings, so these are the real corpus values ──
PUB_TYPES = [
    ("Article de revue", 0.68), ("Chapitre de livre", 0.10), ("Autre", 0.06),
    ("Communication de conférence", 0.06), ("Thèse", 0.04),
    ("Prépublication", 0.04), ("Monographie", 0.02),
]
OA_STATUS = [
    ("gold", 0.24), ("green", 0.16), ("hybrid", 0.06), ("bronze", 0.07),
    ("diamond", 0.03), ("closed", 0.32), ("unknown", 0.12),
]
OA_COLOR = {
    "gold": "gold", "green": "green_only", "hybrid": "hybrid", "bronze": "bronze",
    "diamond": "diamond", "closed": "closed", "unknown": "other",
}
QUARTILES = [("Q1", 0.34), ("Q2", 0.24), ("Q3", 0.16), ("Q4", 0.10), (None, 0.16)]
JOURNAL_ACCESS = [
    ("abonnement_courant", 0.38), ("archives", 0.10), ("inconnu", 0.10), (None, 0.42),
]
COLLAB = "Avec d'autres labos de Nantes Université"
COLLAB_NAT = "Nationales (hors Nantes Université)"
COLLAB_INT = "Internationales"
COLLAB_NONE = "Pas de collaboration"

# Fictitious international partners (name, country code, city, lat, lon).
INTL_PARTNERS = [
    ("Fictive University of Lisbon", "PT", "Lisbonne", 38.7223, -9.1393),
    ("Demo Institute of Technology", "DE", "Munich", 48.1351, 11.5820),
    ("North Atlantic Research Center", "CA", "Montréal", 45.5017, -73.5673),
    ("Sample University of Tokyo", "JP", "Tokyo", 35.6762, 139.6503),
    ("Example Polytechnic", "CH", "Zurich", 47.3769, 8.5417),
    ("Placeholder University", "US", "Boston", 42.3601, -71.0589),
    ("Mock University of Madrid", "ES", "Madrid", 40.4168, -3.7038),
    ("Test University of Milan", "IT", "Milan", 45.4642, 9.1900),
    ("Imaginary College London", "GB", "Londres", 51.5074, -0.1278),
    ("Fictional University of Uppsala", "SE", "Uppsala", 59.8586, 17.6389),
]
# Fictitious national partners (name, city, lat, lon).
NAT_PARTNERS = [
    ("Université de Démonstration de Lyon", "Lyon", 45.7640, 4.8357),
    ("Institut Fictif de Toulouse", "Toulouse", 43.6047, 1.4442),
    ("Centre d'Études de Rennes (démo)", "Rennes", 48.1173, -1.6778),
    ("École Exemple de Grenoble", "Grenoble", 45.1885, 5.7245),
    ("Laboratoire Modèle de Bordeaux", "Bordeaux", 44.8378, -0.5792),
    ("Université Témoin de Strasbourg", "Strasbourg", 48.5734, 7.7521),
]

TODAY = "2026-09-24"

DEMO_LABS = {
    "lira": {
        "acronym": "LIRA", "name": "Laboratoire d'Informatique et Réseaux Appliqués", "etpr": 42,
        "axes": [
            ("Intelligence artificielle", ["apprentissage", "réseaux de neurones", "IA"]),
            ("Réseaux & systèmes distribués", ["réseau", "distribué", "pair-à-pair"]),
            ("Cybersécurité", ["sécurité", "cryptographie", "vie privée"]),
        ],
        "domains": ["Physical Sciences"],
        "subfields": ["Artificial Intelligence", "Computer Networks and Communications",
                      "Computer Security and Cryptography", "Software"],
        "topics": ["Machine learning for networks", "Peer-to-peer systems",
                   "Privacy-preserving computation", "Graph neural networks"],
        "journals": [("Journal of Fictional Computing", "2000-0001", "Demo Press"),
                     ("Transactions on Applied Networks", "2000-0002", "Sample Publishing"),
                     ("Review of Machine Intelligence (démo)", "2000-0003", "Mock Journals")],
    },
    "bios": {
        "acronym": "BIOS", "name": "Biologie des Organismes et des Systèmes", "etpr": 31,
        "axes": [
            ("Génomique fonctionnelle", ["génome", "expression", "séquençage"]),
            ("Écologie des populations", ["écologie", "biodiversité", "population"]),
            ("Biologie des systèmes", ["modélisation", "systèmes", "métabolisme"]),
        ],
        "domains": ["Life Sciences"],
        "subfields": ["Genetics", "Ecology", "Molecular Biology", "Systems Biology"],
        "topics": ["Functional genomics", "Population ecology modelling",
                   "Metabolic networks", "Conservation biology"],
        "journals": [("Fictional Journal of Genomics", "2000-1001", "Demo Life Press"),
                     ("Ecology Letters (échantillon)", "2000-1002", "Sample Bio"),
                     ("Systems Biology Review (démo)", "2000-1003", "Mock Bio")],
    },
    "lmd": {
        "acronym": "LMD", "name": "Laboratoire de Mathématiques de Démonstration", "etpr": 26,
        "axes": [
            ("Analyse & EDP", ["analyse", "équations", "opérateurs"]),
            ("Probabilités & statistiques", ["probabilité", "aléatoire", "statistique"]),
            ("Géométrie", ["géométrie", "topologie", "variété"]),
        ],
        "domains": ["Physical Sciences"],
        "subfields": ["Analysis", "Probability and Statistics", "Geometry and Topology",
                      "Applied Mathematics"],
        "topics": ["Partial differential equations", "Stochastic processes",
                   "Differential geometry", "Numerical analysis"],
        "journals": [("Fictional Journal of Analysis", "2000-2001", "Demo Math Press"),
                     ("Annals of Sample Probability", "2000-2002", "Mock Math"),
                     ("Review of Demonstrative Geometry", "2000-2003", "Example Math")],
    },
}

DEMO2_LABS = {
    "mecademo": {
        "acronym": "MécaDémo", "name": "Laboratoire de Mécanique et Matériaux de Démonstration", "etpr": 24,
        "axes": [
            ("Matériaux composites", ["composite", "fibre", "fatigue"]),
            ("Mécanique des fluides", ["écoulement", "turbulence", "aérodynamique"]),
            ("Procédés de fabrication", ["fabrication additive", "usinage", "procédé"]),
        ],
        "domains": ["Physical Sciences"],
        "subfields": ["Mechanics of Materials", "Fluid Flow and Transfer Processes",
                      "Industrial and Manufacturing Engineering", "Materials Chemistry"],
        "topics": ["Fatigue of composite structures", "Turbulent flow simulation",
                   "Additive manufacturing processes", "Fibre-reinforced polymers"],
        "journals": [("Journal of Fictional Mechanics", "2000-3001", "Demo Engineering Press"),
                     ("Composite Structures (échantillon)", "2000-3002", "Sample Publishing"),
                     ("Review of Demonstrative Fluid Dynamics", "2000-3003", "Mock Journals")],
    },
    "syndemo": {
        "acronym": "SynDémo", "name": "Laboratoire des Systèmes Numériques de Démonstration", "etpr": 17,
        "axes": [
            ("Systèmes embarqués", ["embarqué", "temps réel", "capteur"]),
            ("Jumeaux numériques", ["jumeau numérique", "simulation", "industrie"]),
            ("Robotique", ["robot", "commande", "vision"]),
        ],
        "domains": ["Physical Sciences"],
        "subfields": ["Control and Systems Engineering", "Hardware and Architecture",
                      "Artificial Intelligence", "Industrial and Manufacturing Engineering"],
        "topics": ["Real-time embedded systems", "Digital twins for manufacturing",
                   "Robot motion planning", "Sensor networks"],
        "journals": [("Journal of Fictional Embedded Systems", "2000-4001", "Demo Press"),
                     ("Transactions on Sample Robotics", "2000-4002", "Example Publishing"),
                     ("Digital Twin Review (démo)", "2000-4003", "Mock Journals")],
    },
}

# One universe per fictitious instance: labs, publication volumes, employers of demo-data.mjs
# (employerKey), aggregate structure and names used in signatures and media.
UNIVERSES = {
    "demo": {
        "seed": 20260708, "labs": DEMO_LABS, "pub_count": {"lira": 148, "bios": 112, "lmd": 96},
        "employers": {"UNIV": "UNIVERSITÉ DE DÉMONSTRATION", "ENS": "ENS-DÉMO", "CNR": "CNRD"},
        "aggregate": {"slug": "udemo", "lab": "UDémo", "name": "Université de Démonstration"},
    },
    "demo-2": {
        "seed": 20260926, "labs": DEMO2_LABS, "pub_count": {"mecademo": 84, "syndemo": 62},
        "employers": {"UNIV": "ÉCOLE D'INGÉNIEURS DE DÉMONSTRATION", "ENS": "UNIVERSITÉ DE DÉMONSTRATION", "CNR": "CNRD"},
        "aggregate": {"slug": "eidemo", "lab": "EIDémo", "name": "École d'Ingénieurs de Démonstration"},
    },
}
# Universe being generated (set by main).
U = UNIVERSES["demo"]
LABS = U["labs"]

YEAR_FROM, YEAR_TO = 2019, 2026


def load_members(path):
    """Researchers of demo-data.mjs grouped by lab; teams are the ones actually in use."""
    labs, teams = {}, {}
    for r in json.load(open(path, encoding="utf-8")):
        end = r.get("employment_end_date") or ""
        departed = bool(end) and end < TODAY
        labs.setdefault(r["LABO"], []).append({
            "label": f"{r['Prenom']} {r['Nom']}",
            "team": r.get("team") or None,
            "isPhd": r["Corps_grade"] == "Doctorant",
            "type": "Titulaire" if r.get("TYPE_EMPLOI") in ("TITULAIRE", "EMERITE") else "Contractuel",
            "employer": U["employers"].get(r.get("employerKey"), ""),
            "departed": departed,
        })
        if r.get("team"):
            teams.setdefault(r["LABO"], [])
            if r["team"] not in teams[r["LABO"]]:
                teams[r["LABO"]].append(r["team"])
    return labs, teams


def pick(weighted):
    r, acc = random.random(), 0.0
    for value, w in weighted:
        acc += w
        if r <= acc:
            return value
    return weighted[-1][0]


_next_author_id = 1


def build_authors(members):
    """Authors = lab members (stable ids, matched) + fictitious co-authors per lab.

    Departed researchers stay authors of their publications but are not in the headcount."""
    global _next_author_id
    authors, member_out, effectifs = [], [], []
    for m in members:
        aid = _next_author_id
        _next_author_id += 1
        teams = [m["team"]] if m["team"] else []
        authors.append({"id": aid, "label": m["label"], "teams": teams, "isPhd": m["isPhd"]})
        if not m["departed"]:
            member_out.append({"label": m["label"], "type": m["type"], "teams": teams,
                               "isPhd": m["isPhd"], "authorId": aid, "employer": m["employer"]})
            effectifs.append(aid)
    extra = []
    for i in range(18):
        aid = _next_author_id
        _next_author_id += 1
        extra.append({"id": aid, "label": f"Co-auteur·rice fictif {i + 1}", "teams": [], "isPhd": False})
    return authors + extra, member_out, effectifs, [a["id"] for a in authors], [a["id"] for a in extra]


TITLE_FRAGMENTS = [
    "A study of", "Modelling", "On the analysis of", "Toward", "Advances in",
    "An empirical evaluation of", "Characterisation of", "Rethinking",
    "A framework for", "Robust methods for",
]
TITLE_SUBJECTS = [
    "adaptive systems", "distributed learning", "gene regulation", "ecological networks",
    "stochastic dynamics", "boundary value problems", "privacy in sensor networks",
    "population resilience", "spectral methods", "graph embeddings",
    "metabolic pathways", "random matrices",
]


def make_charte(modele, nu_seul):
    crit = {
        "nantes_universite": nu_seul,
        "structure": random.random() < 0.85,
        "code_unite": random.random() < 0.7,
        "adresse": random.random() < 0.8,
        "tutelles": random.choice([True, False, None]),
    }
    score = round(sum(1 for v in crit.values() if v) / 5, 2)
    return {"score": score, "conforme": score >= 0.8, "nuSeul": nu_seul,
            "signature": f"{modele}, {U['aggregate']['name']}, F-44000 Démoville, France",
            "modele": modele, "criteres": crit}


CRISALID_HARVESTERS = ["hal", "scanr", "idref", "openalex", "scopus"]
SOURCE_PRIORITY = ["crisalid", "bso", "openalex", "hal"]
SOURCE_DB = {"crisalid": "CRISalid", "bso": "BSO", "openalex": "OpenAlex", "hal": "HAL"}


def make_provenance():
    crisalid = random.random() < 0.55
    sources = ["crisalid"] if crisalid else []
    if not (crisalid and random.random() < 0.35):  # otherwise: CRISalid harvester only
        if random.random() < 0.60:
            sources.append("bso")
        if random.random() < 0.72:
            sources.append("openalex")
        if random.random() < 0.55:
            sources.append("hal")
        if sources == ["crisalid"] or not sources:
            sources.append(random.choice(["openalex", "hal"]))
    source_db = SOURCE_DB[next(s for s in SOURCE_PRIORITY if s in sources)]
    harvesters = []
    if crisalid:
        n = random.choices([1, 2, 3], weights=[45, 35, 20])[0]
        harvesters = sorted(random.sample(CRISALID_HARVESTERS, n))
    lookup = None
    if crisalid:
        lookup = "matched_corpus" if "openalex" in sources else random.choices(
            ["found_by_id", "found_by_doi", "not_found", "no_doi"], weights=[25, 20, 30, 25])[0]
    return sources, source_db, harvesters, lookup


FUNDER_POOL = [
    ("Agence Nationale de la Recherche", True, 30),
    ("Commission européenne", True, 14),
    ("European Research Council", True, 8),
    ("Centre National de la Recherche Scientifique", True, 12),
    ("Institut National de la Santé et de la Recherche Médicale", True, 8),
    ("Conseil Régional UDémo", False, 10),
    ("National Science Foundation", True, 7),
    ("Deutsche Forschungsgemeinschaft", True, 6),
    ("Fondation pour la Recherche Démo", False, 5),
]
PROJECT_ACRONYMS = ["NEXUS", "ORIGAMI", "BIOWAVE", "QUANTA", "ATLAS", "PRISME",
                    "SOLSTICE", "MOSAIC", "VERTIGO", "HARMONIA"]


def make_funders():
    """Fictitious (funders, awards), same keys as the real export."""
    if random.random() > 0.45:
        return [], []
    pool = FUNDER_POOL[:]
    k = min(random.choices([1, 2, 3], weights=[55, 32, 13])[0], len(pool))
    funders, awards = [], []
    for _ in range(k):
        name, has_id, _w = random.choices(pool, weights=[w for _, _, w in pool])[0]
        pool = [p for p in pool if p[0] != name]
        fid = f"https://openalex.org/F43203{random.randint(10000, 99999)}" if has_id else None
        funders.append({"id": fid, "name": name, "ror": None})
        if random.random() < 0.7:  # attached project/grant
            if name.startswith("Agence Nationale"):
                pid = f"ANR-{random.randint(16, 23)}-CE{random.randint(1, 55):02d}-{random.randint(0, 9999):04d}"
                pname = random.choice(PROJECT_ACRONYMS)
                src = "hal" if random.random() < 0.4 else "openalex"
            elif "europ" in name.lower() or name.startswith("European"):
                pid = str(random.randint(600000, 999999))
                pname = random.choice(PROJECT_ACRONYMS)
                src = "openalex"
            else:
                pid = (f"{random.choice(['GA', 'PRC', 'DFG'])}-{random.randint(1000, 99999)}"
                       if random.random() < 0.5 else None)
                pname = random.choice(PROJECT_ACRONYMS) if random.random() < 0.5 else None
                src = "openalex"
            awards.append({"funderId": fid, "funderName": name, "projectId": pid,
                           "projectName": pname, "source": src})
    return funders, awards


def make_pub(lab_slug, cfg, lab_teams, member_ids, extra_ids, sibling_labs):
    year = random.randint(YEAR_FROM, YEAR_TO)
    ptype = pick(PUB_TYPES)
    lang = "en" if random.random() < 0.62 else "fr"
    oa = pick(OA_STATUS)
    quartile = pick(QUARTILES)
    journal, issn, publisher = random.choice(cfg["journals"])

    author_ids = random.sample(member_ids, random.randint(1, min(3, len(member_ids))))
    if random.random() < 0.6:
        author_ids += random.sample(extra_ids, random.randint(1, 3))
    author_ids = list(dict.fromkeys(author_ids))

    # Labs without teams (LMD, part of BIOS) publish without a team.
    teams = sorted({t for t in lab_teams if random.random() < 0.5}) or lab_teams[:1]

    collab, countries, partner_inst, nat_partners, nantes_partners = [], ["FR"], [], [], []
    if random.random() >= 0.22:
        if random.random() < 0.45:  # international
            collab.append(COLLAB_INT)
            for name, cc, city, lat, lon in random.sample(INTL_PARTNERS, random.randint(1, 3)):
                partner_inst.append({"name": name, "cc": cc, "city": city, "lat": lat, "lon": lon})
                if cc not in countries:
                    countries.append(cc)
        if random.random() < 0.5:  # national
            collab.append(COLLAB_NAT)
            for name, city, lat, lon in random.sample(NAT_PARTNERS, random.randint(1, 2)):
                nat_partners.append({"name": name, "city": city, "lat": lat, "lon": lon})
        if random.random() < 0.3 and sibling_labs:  # with another lab of the university
            collab.append(COLLAB)
            nantes_partners = random.sample(sibling_labs, 1)
    if not collab:
        collab = [COLLAB_NONE]

    axe_name, axe_kw = random.choice(cfg["axes"])
    has_apc = oa in ("gold", "hybrid") and random.random() < 0.7
    apc_amount = random.choice([1200, 1800, 2400, 2900, 3200]) if has_apc else None
    apc_detail = None
    if has_apc:
        apc_detail = {
            "listAmount": apc_amount, "listCurrency": "EUR", "listUsd": round(apc_amount * 1.08),
            "paidAmount": apc_amount, "paidCurrency": "EUR", "paidUsd": round(apc_amount * 1.08),
            "correspondingAuthors": [], "correspondingInstitutions": [cfg["acronym"]],
            "correspondingCountries": ["FR"],
        }

    fwci = round(random.gammavariate(1.6, 0.9), 3)
    cited = int(random.expovariate(1 / 8))
    nu_seul = random.random() < 0.55
    sources, source_db, cr_harvesters, oa_lookup = make_provenance()
    funders, awards = make_funders()
    is_article = ptype == "Article de revue"

    return {
        "sources": sources, "sourceDb": source_db,
        "crisalidHarvesters": cr_harvesters, "openalexLookup": oa_lookup,
        "funders": funders, "awards": awards,
        "year": year, "language": lang, "isForeignLanguage": lang != "fr",
        "pubType": ptype, "oaStatus": oa, "oaColor": OA_COLOR[oa],
        "isInternational": COLLAB_INT in collab, "hasApc": has_apc,
        "apcAmount": apc_amount, "apcCurrency": "EUR" if has_apc else None,
        "apcDetail": apc_detail,
        "journal": journal if is_article else None,
        "countries": countries,
        "subfields": random.sample(cfg["subfields"], random.randint(1, 2)),
        "partnerInstitutions": partner_inst,
        "sjrQuartile": quartile, "fwci": fwci, "citedByCount": cited,
        "isTop10Percent": fwci > 2.2, "isTop1Percent": fwci > 4.5,
        "teams": teams, "authorIds": author_ids,
        "authorCount": len(author_ids) + random.choice([0, 0, 1, 2, 4]),
        "hasPhd": random.random() < 0.28,
        "collabTypes": collab, "sousStructures": teams[:] if len(teams) > 1 else [],
        "nantesPartners": nantes_partners, "nationalPartners": nat_partners,
        "domains": cfg["domains"],
        "title": f"{random.choice(TITLE_FRAGMENTS)} {random.choice(TITLE_SUBJECTS)}",
        "doi": f"https://doi.org/10.5555/demo.{lab_slug}.{random.randint(10000, 99999)}",
        "topics": random.sample(cfg["topics"], random.randint(1, 2)),
        "chosenTheme": "Autre / Non classé",
        "chosenAxe": axe_name,
        "axeMotivation": "Mots-clés : " + ", ".join(random.sample(axe_kw, min(2, len(axe_kw)))),
        "issn": issn if is_article else None,
        "journalAccess": pick(JOURNAL_ACCESS) if is_article else None,
        "licenceNationale": random.random() < 0.15,
        "journalPublisher": publisher if is_article else None,
        "charte": make_charte(cfg["acronym"], nu_seul),
    }


def build_lab(slug, cfg, members, lab_teams, sibling_names):
    authors, member_out, effectifs, member_ids, extra_ids = build_authors(members)
    pubs = [make_pub(slug, cfg, lab_teams, member_ids, extra_ids, sibling_names)
            for _ in range(U["pub_count"][slug])]
    return {
        "lab": cfg["acronym"], "name": cfg["name"], "slug": slug,
        "teamLabel": "équipe", "etpr": cfg["etpr"], "filterToEffectifs": False,
        "charteModele": cfg["acronym"], "charteComposite": False,
        "strategicAxes": [{"name": n, "keywords": kw} for n, kw in cfg["axes"]],
        "publications": pubs, "authors": authors, "members": member_out,
        "effectifsAuthorIds": effectifs, "countryNames": COUNTRY_NAMES,
    }


# Fixed dates: deterministic output (« Veille » tab, static demo).
NEWS_FETCHED_AT = "2026-09-24T09:00:00Z"
NEWS_DATES = [f"2026-{m:02d}-{d:02d}" for m in (7, 8, 9) for d in (3, 9, 15, 21)]


def build_news(slug, cfg, data):
    """Fictitious « Veille »: recent publications signed by the structure."""
    authors = [m["label"] for m in data["members"]] or [a["label"] for a in data["authors"]]
    items = []
    for i in range(24):
        journal, issn, _publisher = random.choice(cfg["journals"])
        oa = pick(OA_STATUS)
        picked = random.sample(authors, random.randint(1, min(4, len(authors))))
        items.append({
            "id": f"W{slug}{1000 + i}",
            "title": f"{random.choice(TITLE_FRAGMENTS)} {random.choice(TITLE_SUBJECTS)}",
            "date": random.choice(NEWS_DATES),
            "link": f"https://doi.org/10.5555/demo.{slug}.news.{i}",
            "doi": f"10.5555/demo.{slug}.news.{i}",
            "workType": "Article de revue",
            "sourceName": journal, "sourceType": "journal", "issn": issn,
            "isOa": oa not in ("closed", "unknown"), "oaStatus": oa,
            "citedByCount": int(random.expovariate(1 / 3)),
            "authors": picked, "allAuthors": picked, "authorsTotal": len(picked),
            "labs": [cfg["acronym"]],
            "topics": random.sample(cfg["topics"], random.randint(1, 2)),
            "subfields": random.sample(cfg["subfields"], random.randint(1, 2)),
            "keywords": random.sample(cfg["axes"][0][1] + cfg["axes"][1][1], random.randint(2, 3)),
        })
    items.sort(key=lambda x: x["date"], reverse=True)
    return {"slug": slug, "days": 90, "fetchedAt": NEWS_FETCHED_AT,
            "total": len(items), "truncated": False, "items": items}


def media_outlets():
    return [
        ("Le Courrier de Démoville", "presse_regionale"), ("Radio Démo", "radio"),
        ("Sciences & Démo", "presse_specialisee"), (f"Le Journal de l'{U['aggregate']['lab']}", "institutionnel"),
        ("Démo TV", "television"), ("The Sample Times", "presse_internationale"),
    ]
MEDIA_TYPES = ["tribune", "interview", "citation_expert", "vulgarisation", "mention_travaux", ""]


def build_mentions():
    """Fictitious media mentions (« Médias » panel), all published structures."""
    items = []
    for i in range(18):
        slug = random.choice(list(LABS))
        media, mtype = random.choice(media_outlets())
        day = random.randint(1, 170)
        date = f"2026-{3 + day // 30:02d}-{1 + day % 28:02d}T08:00:00+00:00"
        subject = random.choice(TITLE_SUBJECTS)
        items.append({
            "id": f"demo-mention-{i + 1:03d}",
            "url": f"https://example.org/media/{slug}/{i + 1}",
            "title": f"{LABS[slug]['acronym']} : des chercheurs de l'{U['aggregate']['lab']} travaillent sur {subject}",
            "excerpt": f"Article fictif de démonstration ({LABS[slug]['name']}).",
            "media_name": media, "media_type": mtype,
            "published_at": date, "collected_at": date, "collector": "rss", "language": "fr",
            "structures": [{"slug": slug, "acro": LABS[slug]["acronym"], "confidence": 1.0, "via": "démo"}],
            "institution": 0, "intervention_type": random.choice(MEDIA_TYPES),
            "status": "auto", "confidence": 1.0,
        })
    items.sort(key=lambda m: m["published_at"], reverse=True)
    return {"generated_at": NEWS_FETCHED_AT, "days": 180, "total": len(items), "items": items,
            "collectors": [{"collector": "rss", "last_run": NEWS_FETCHED_AT, "last_status": "ok",
                            "last_count": len(items), "consecutive_empty": 0}]}


def write_json(path, data, indent=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
        f.write("\n")


def main():
    global U, LABS
    args = sys.argv[1:]
    instance = "demo"
    if len(args) == 3 and args[0] == "--instance" and args[1] in UNIVERSES:
        instance, args = args[1], args[2:]
    if len(args) != 1:
        sys.exit(__doc__)
    U, LABS = UNIVERSES[instance], UNIVERSES[instance]["labs"]
    out = os.path.join(HERE, "..", instance, "dashboard-data")
    random.seed(U["seed"])
    members_by_lab, teams_by_lab = load_members(args[0])
    sibling_names = {s: [LABS[o]["acronym"] for o in LABS if o != s] for s in LABS}
    built = {}
    for slug, cfg in LABS.items():
        members = members_by_lab.get(cfg["acronym"], [])
        if not members:
            sys.exit(f"No researcher for {cfg['acronym']} in {args[0]}")
        data = build_lab(slug, cfg, members, teams_by_lab.get(cfg["acronym"], []), sibling_names[slug])
        write_json(os.path.join(out, slug, "dashboard.json"), data)
        write_json(os.path.join(out, slug, "news.json"), build_news(slug, cfg, data))
        built[slug] = data
        print(f"{slug}: {len(data['publications'])} publications, {len(data['members'])} members")

    # Institution-level aggregate (« udemo » for the demo): union of the labs.
    agg = U["aggregate"]
    udemo = {
        "lab": agg["lab"], "name": agg["name"], "slug": agg["slug"],
        "teamLabel": "laboratoire", "etpr": sum(c["etpr"] for c in LABS.values()),
        "filterToEffectifs": False, "charteModele": agg["lab"], "charteComposite": True,
        "strategicAxes": [],
        "publications": [p for d in built.values() for p in d["publications"]],
        "authors": [a for d in built.values() for a in d["authors"]],
        "members": [m for d in built.values() for m in d["members"]],
        "effectifsAuthorIds": [i for d in built.values() for i in d["effectifsAuthorIds"]],
        "countryNames": COUNTRY_NAMES,
    }
    udemo_cfg = {
        "acronym": agg["lab"],
        "journals": [j for c in LABS.values() for j in c["journals"]],
        "topics": [t for c in LABS.values() for t in c["topics"]],
        "subfields": [s for c in LABS.values() for s in c["subfields"]],
        "axes": [ax for c in LABS.values() for ax in c["axes"]],
    }
    write_json(os.path.join(out, agg["slug"], "dashboard.json"), udemo)
    write_json(os.path.join(out, agg["slug"], "news.json"), build_news(agg["slug"], udemo_cfg, udemo))
    print(f"{agg['slug']} (aggregate): {len(udemo['publications'])} publications, {len(udemo['members'])} members")

    slugs = [agg["slug"]] + list(LABS)
    # Benchmark needs server routes (/api/benchmark/*): hidden, like on Centrale.
    write_json(os.path.join(out, "index.json"),
               {"slugs": slugs, "groups": [], "tabsHidden": {s: ["benchmark"] for s in slugs}}, indent=1)
    write_json(os.path.join(out, "mentions.json"), build_mentions())
    print(f"index.json: {slugs}; mentions.json")


if __name__ == "__main__":
    main()
