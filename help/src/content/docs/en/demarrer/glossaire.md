---
title: "Glossary"
description: "The terms used in Druid: record, status, validation, affiliation, alignment, strong candidate…"
sidebar:
  order: 3
---

Terms are grouped by theme. Each definition links to the page that explains it in detail.

## People

- **Directory**: the table holding one record per person and per laboratory. It is Druid's
  source of truth: what you correct in Druid is written there.
- **Record**: a row of the directory: one person in one structure. The same person can have
  several records if they belong to several laboratories.
- **uid**: the person's identifier in the institution's LDAP directory. External people
  (without an account) get a dummy uid starting with `ext_`.
- **Status**: *Internal* (in post), *Leaving* (departure announced), *Left* (no longer here)
  or *External* (employed by another institution, or without an account). Calculated
  automatically, unless validated by hand. → [Statuses of people](/en/donnees/statuts-des-personnes/)
- **Validation**: manual confirmation of the status and/or the affiliation of a record, with
  a source and a date. It prevails over the automatic calculation for 18 months, after which
  the record is flagged *expired*. → [Statuses of people](/en/donnees/statuts-des-personnes/#manual-validation)
- **Emeritus**: a retired academic or researcher who keeps a research activity. Druid gives
  them a grade of their own (MCFEM, DREM, PREM). → [Statuses of people](/en/donnees/statuts-des-personnes/#emeritus-and-retired-staff)
- **Employment**: the employment contract: employer, grade, start and end dates. Not to be
  confused with membership.
- **Membership**: the dated link between a person and a structure (laboratory, team),
  independent of the employment contract. → [Memberships and affiliation](/en/donnees/appartenances-rattachement/)
- **Primary affiliation**: the membership that counts for the affiliation of publications
  and for the export to CRISalid. → [Memberships and affiliation](/en/donnees/appartenances-rattachement/#primary-affiliation)
- **Imprecise date**: a date entered to the year (`2022`), the month (`2022-09`) or the day
  (`2022-09-01`), depending on what is known. → [Memberships and affiliation](/en/donnees/appartenances-rattachement/#imprecise-dates)
- **Duplicate**: two records with the same uid: either the same membership entered twice (to
  merge), or a genuine double membership (to qualify). → [Handle a duplicate](/en/guides/personnes/traiter-un-doublon/)
- **Task**: a correction to make outside Druid (on IdRef, ORCID, HAL…), followed up in the
  *To process* section. → [Follow up “To process” tasks](/en/guides/personnes/taches-a-traiter/)

## Structures

- **Structure**: an institution, a faculty, a laboratory or a team, described with a common
  four-level model. → [Structures](/en/donnees/structures/)
- **Supervising body** (*tutelle*): the institution or organisation that runs a structure
  (university, CNRS, Inserm…). The *main supervising body* is the reference one.
- **Inclusion**: a strong membership of one structure in another: a team is included in its
  laboratory, a laboratory in its cluster or faculty.
- **Participation**: a weaker link: supervising bodies, federations, a laboratory taking part
  in a network.
- **Group**: a cross-cutting selection of researchers (a council, a project, a cohort), with
  its own dashboard.

## Identifiers

- **Alignment**: matching a record with its identifier in an external source (IdRef, ORCID,
  HAL, OpenAlex, Scopus, LDAP directory). → [Researcher identifiers](/en/donnees/identifiants-chercheurs/)
- **Candidate**: an identifier suggested by Druid for a record. It is only written after you
  approve it.
- **Strong candidate**: an almost certain candidate (an already known identifier is found on
  the profile, or exact name and matching affiliation). It can be ticked in bulk.
- **Ambiguous**: several plausible candidates for the same record: you have to choose.
- **Conflict**: the record already holds an identifier different from the one found. Druid
  never overwrites an existing value: it is up to you to decide.
- **Mixed identity**: a remote profile (IdRef, HAL, OpenAlex…) that mixes the works of
  several people. It is fixed at the source, not in Druid.
- **IdRef, PPN**: the person authority file of ABES (the French agency for higher-education
  libraries); the PPN is the number of an IdRef record.
- **ORCID**: an international identifier that researchers create and manage themselves.
- **IdHAL**: an author identifier in the HAL open archive, created by the author.
- **A-id (OpenAlex)**: the identifier of an OpenAlex author profile, starting with `A`. A
  person can have several.
- **Scopus Author ID**: the author identifier of the Scopus database (Elsevier).

## Publications and dashboard

- **Scope**: for the dashboard, *Affiliation* (all publications signed by the structure) or
  *Headcount* (those with at least one author recognised among the validated members).
  → [Publications and attribution](/en/donnees/publications-attribution/#the-two-scopes-of-the-dashboard)
- **Signature charter**: the affiliation form recommended by the institution; the dashboard
  measures how well publications comply with it. → [Publications and attribution](/en/donnees/publications-attribution/)
- **FWCI**: *Field-Weighted Citation Impact*: the citations of a publication relative to the
  world average of comparable publications. 1 = world average.
  → [Indicators](/en/donnees/indicateurs/#fwci)
- **Top 1% / top 10%**: publications among the 1% or 10% most cited of their field and year.
- **Quartile (SJR)**: the rank of the journal in its discipline according to the SCImago
  ranking, from Q1 (the best-ranked quarter) to Q4.
- **APC**: *Article Processing Charges*: publication fees paid to a publisher to publish in
  open access.
- **ETL**: the processing chain that harvests and calculates the dashboard data (“extract,
  transform, load”).

## Druid itself

- **Instance**: a deployment of Druid for an institution, with its data and its enabled
  features. → [Instances and features](/en/donnees/instances-fonctionnalites/)
- **Profile**: all the rights of your account (lab member, central services,
  administrator…). → [First steps for your profile](/en/demarrer/premiers-pas/)
- **CRISalid**: the open-source software chain that harvests researchers' publications and
  exposes them (notably in SoVisu+). Druid provides it with the list of researchers and
  their identifiers.
