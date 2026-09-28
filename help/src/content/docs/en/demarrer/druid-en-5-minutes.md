---
title: "Druid in 5 minutes"
description: "What Druid does, the sections of the menu and where the data come from."
sidebar:
  order: 1
---

Druid is the tool for **managing an institution's research directory**: who works in which
laboratory, with which researcher identifiers, and what these people publish. It is used both
to **make the data reliable** (statuses, affiliations, identifiers) and to **make use of it**
(bibliometric dashboards, exports).

It feeds the [CRISalid](https://www.crisalid.org/) chain: the records made reliable in Druid
are the ones used to harvest each researcher's publications.

## What you can do with Druid

- **Keep the directory up to date**: find a person, check their status (in post, left,
  external…), their laboratory and team, correct a record.
- **Complete researcher identifiers**: IdRef, ORCID, IdHAL, OpenAlex, Scopus. Druid suggests
  candidates; you accept or reject them.
- **Describe research structures**: laboratories, teams, faculties, with their identifiers
  (RNSR, ROR, UAI…) and their supervising bodies.
- **Analyse the scientific output** of a laboratory or a group of researchers: volume, open
  access, impact, collaborations, journals, APCs.
- **Build reports**: bibliometric reports from the dashboard charts or from templates (review,
  collaborations, funding, journals), shared and exported as PDF.
- **Export**: lists as CSV, Excel or PDF, a file for ABES, charts you can embed in a website.

## The sections of the menu

| Section | What you find there | Who sees it |
|---|---|---|
| **People** | The list of records, with filters and charts (gender balance, ages, grades, identifier coverage). A click opens a person's record. | Everyone (limited to their lab for a lab profile) |
| **Structures** | Laboratories, teams and faculties, their hierarchy and their description. | Central services and administrators |
| **Groups** | Cross-cutting selections of researchers (a council, a project, a cohort) with their own dashboard. | Administrators |
| **Dashboard** | The bibliometric indicators of a structure or a group, in about fifteen tabs. | Everyone (limited to their lab for a lab profile) |
| **My reports** | Your bibliometric reports, those shared with you and those visible to everyone; creation from a template, PDF export. | Everyone (on the structures they see) |
| **Alignment tools** | Researcher identifier alignment and, if your instance is connected to an LDAP directory, LDAP alignment. | Central services and administrators |
| **Administration** | ETL console, rights management, media sources for the news watch, depending on your profile. | Administrators and communication officers |

Sections your profile cannot use do not appear: see
[First steps for your profile](/en/demarrer/premiers-pas/).

## Where the data come from

Druid creates almost nothing itself: it **gathers and cross-checks** several sources.

- **The directory**: a shared table (in Grist) holding one record per person and per
  laboratory. It is Druid's source of truth; what you correct in Druid is written there.
- **The institution's LDAP directory**, if your instance is connected to it: it tells whether
  an account is active and provides the grade, the employer and the employment dates.
- **Identifier registries** (IdRef, ORCID, HAL, OpenAlex, Scopus), queried to suggest
  candidates.
- **Bibliographic sources** (OpenAlex, the French Open Science Monitor, HAL, the CRISalid
  graph) for the dashboards.

The details, with update frequencies, are in
[Where the data come from](/en/donnees/sources-des-donnees/).

## Three notions to know

- **Status**: Internal, Leaving, Left or External. It is calculated automatically, and an
  authorised person can confirm it by hand (“validate the record”). See
  [Statuses of people](/en/donnees/statuts-des-personnes/).
- **Primary affiliation**: the laboratory (and team) that counts for the affiliation of
  publications and for the export to CRISalid. See
  [Memberships and affiliation](/en/donnees/appartenances-rattachement/).
- **Candidate**: an identifier (IdRef, ORCID…) suggested by Druid, with a confidence level.
  Nothing is written without your approval. See
  [Researcher identifiers](/en/donnees/identifiants-chercheurs/).

The other terms are in the [glossary](/en/demarrer/glossaire/).

## In the top bar

- **?**: opens this help centre. On every page of Druid, a **?** button next to the title
  opens the help for that page (or for the tab on display).
- **FR / EN**: switches the language of the interface.
- **Dark mode / Light mode**: changes the display theme.
- **Your name** and **Log out**.

On some instances, a **chat assistant** (floating button at the bottom right) has two tabs:

- **Druid help** answers “how do I…” questions from this help centre, with links to the
  pages it used;
- **CRISalid data** answers questions about the institution's research (publications,
  laboratories, expertise).

## What next?

- [First steps for your profile](/en/demarrer/premiers-pas/): what you, personally, can do.
- [Where to fix what](/en/guides/corriger/ou-corriger-quoi/): some data look wrong.
- [Support](/en/guides/support/): ask a question or request access.
