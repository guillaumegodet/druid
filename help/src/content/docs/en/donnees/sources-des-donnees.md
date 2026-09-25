---
title: "Where the data come from"
description: "Druid's sources (directory, Grist, OpenAlex, BSO, HAL, IdRef, SJR…) and how often they are updated."
sidebar:
  order: 1
---

## What it is

Druid gathers data from several systems. Knowing where a piece of information comes from
helps you understand **why it is what it is**, **when it changes** and **where to correct
it**.

## Data flows

```
 LDAP directory ─┐                            ┌─► Export to CRISalid ──► harvesting
 (if connected)  │                            │   (researchers, structures,  of publications
                 ▼                            │    identifiers)
 Entries ───► DIRECTORY (Grist) ◄──► DRUID ───┤
 in Druid        ▲                            │
                 │                            └─► Dashboard ◄── bibliometric ETL
 IdRef, ORCID, ──┘                                               (OpenAlex, BSO, HAL,
 HAL, OpenAlex,                                                   CRISalid graph,
 Scopus (candidates)                                              SJR)
```

## People and structures

| Source | What it provides | Update |
|---|---|---|
| **Directory (Grist)** | The records of people and structures. It is the **source of truth**: everything you change in Druid is written there immediately. | Continuous |
| The institution's **LDAP directory** (if your instance is connected to it) | Account state, grade, employer, employment dates, the institution's structures. | At each synchronisation started from Druid, after reviewing the differences |
| **Validated lists** | Lists sent by laboratories, imported to validate records in bulk. | On demand |

Druid does not blindly copy the LDAP directory: a synchronisation first shows the
differences, and records validated by hand are protected (see
[Statuses of people](/en/donnees/statuts-des-personnes/)).

## Researcher identifiers

| Source | Update |
|---|---|
| **IdRef** (ABES), **ORCID**, **HAL** | Searches started on demand, per laboratory or per group |
| **OpenAlex** | Search for missing profiles and check of existing ones, rerun regularly (depending on the instance's configuration) |
| **Scopus** (Elsevier) | On demand, within the API's weekly quotas |

The candidates found are only written after validation: see
[Researcher identifiers](/en/donnees/identifiants-chercheurs/).

## Publications and indicators

The dashboards are calculated by a processing chain (the **bibliometric ETL**) that queries,
for each structure:

| Source | What it provides |
|---|---|
| **OpenAlex** | Worldwide open database: publications, authors, institutions, citations, FWCI, topics, list-price APCs. |
| **French Open Science Monitor (BSO)** | French publications with a DOI and their open-access status (via Unpaywall). Takes priority for duplicates. |
| **HAL** | Deposits of the structure's HAL collection, including those without a DOI. |
| **CRISalid graph** | Publications harvested for the structure's researchers from their identifiers. |
| **SCImago (SJR)** | Journal quartiles. |
| **OpenAPC** | APC spending actually reported by institutions. |

Duplicate publications (same DOI) are merged.

**Frequency**: a dashboard is **regenerated on demand** by the technical team (ETL console),
usually after an update of the headcount or ahead of an evaluation report. Between two
regenerations, the figures do not move, even if the sources change: if in doubt about how
fresh a dashboard is, ask [support](/en/guides/support/) for the date of the last generation.

The news watch (**Watch** tab) is fed every day by the collection of media mentions.

## The Sources tab of the dashboard

The **Sources** tab compares, for the structure on display, the publications found by the
CRISalid harvester (from the researchers' identifiers) with those found by the ETL (BSO,
OpenAlex, HAL). It helps you spot:

- publications that CRISalid does not find, often because a researcher is **missing an
  identifier**;
- the databases through which CRISalid finds its publications (HAL, ScanR, IdRef/Sudoc,
  OpenAlex, Scopus);
- sources that cover a discipline poorly (for example books in the humanities, often missing
  from OpenAlex).

## Known limitations

- **Lag between sources**: a person can have left according to the LDAP directory and still
  be present in a dashboard that has not been regenerated.
- **Uneven coverage**: OpenAlex and the BSO cover articles with a DOI well, books, chapters
  and conference papers without a DOI less well; HAL depends on the deposits made by
  researchers.
- **Delays of external databases**: a recent publication can take several weeks to appear in
  OpenAlex or the BSO.
- **Features depending on the instance**: the LDAP directory, rerunning searches and the
  export to CRISalid do not exist on every instance (see
  [Instances and features](/en/donnees/instances-fonctionnalites/)).

## How to report an error

See [Where to fix what](/en/guides/corriger/ou-corriger-quoi/): depending on where an error
comes from, the correction is made in Druid, in the LDAP directory, in HAL or in an external
database.
