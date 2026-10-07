---
title: "What's new"
description: "The visible changes in Druid, month by month."
sidebar:
  order: 1
---

The changes in Druid you may notice, month by month. Some features only exist on the
instances that have them (see [Instances and features](/en/donnees/instances-fonctionnalites/)).

## October 2026

### Dashboard

- **Collaborations › By country**: the review of the collaborations with one partner country —
  key figures and rank, trend, institutions of the country on a map and by province or region,
  labs and researchers involved, « who works with whom », themes and specialization, impact,
  funders. See
  [Analyse collaborations](/en/guides/tableau-de-bord/collaborations/#review-collaborations-with-a-country).
- **More complete publication countries**: the countries of the co-signing institutions now
  count; the international figures rise.
- **Richer Researchers tab**: population filter (membership, category, presence),
  headcount, research FTE, **publication rate per research FTE and per age bracket**, age
  pyramid, publications per member, table exportable as CSV. See
  [Read the staff and the publication rate per FTE](/en/guides/tableau-de-bord/chercheurs-effectifs/).

### Reports

- **New « Collaboration with a country » template**: the full review of a collaboration with one
  country, with no figure written in the texts. The **International collaborations** template
  now covers every country. See
  [Report templates](/en/guides/rapports/modeles/#collaboration-with-a-country).

### People

- **FTE (working time) and Research FTE** on the record, « Employment & contract » card.
- **End of “Internal / External”**: every record now shows its **presence** (Present,
  Leaving, Left), its **employer** and its **LDAP account**, three independent pieces of
  information. New **Presence**, **Employer** (home institution, other employers, not
  specified) and **LDAP account** filters, and an **Internal staff** shortcut. Old links
  filtered on a status still work. See [Statuses of people](/en/donnees/statuts-des-personnes/).
- **Staff number** (HR identifier) shown on the record, taken from the LDAP directory.
- **Employer deduced from LDAP** when creating a record (“Fill from LDAP”) when it is
  certain: the institution's staff, CNRS accounts.
- New **tasks**: switch an `ext_…` record to its LDAP uid (found by the staff number), hosted
  LDAP account closing, employer to enter.

## September 2026

### Help

- **This help centre** is online: getting started, how-to guides, tutorials and pages
  explaining the data.
- **An English version of the help centre**: language selector at the top of every page.
- **A “?” button on every page of Druid** opens the help for the page (or tab) on display; a
  link to the help centre is in the top bar.
- **“Druid help” assistant**: in the assistant (button at the bottom right), a tab answers
  “how do I…” questions from this help centre and cites the pages it used.

### People

- **“To process” section** (administrators): duplicates to merge and **tasks** to carry out
  outside Druid (IdRef, ORCID, HAL, OpenAlex, HR), with e-mails ready to send to researchers
  and tasks created automatically. See
  [Follow up “To process” tasks](/en/guides/personnes/taches-a-traiter/).
- **Imprecise dates**: employment and membership dates are entered to the year, the month or
  the day; **→ employment end** button. A past employment end and a past membership end make
  the person **Left**. See
  [Enter imprecise employment dates](/en/guides/personnes/dates-imprecises/).
- **Membership dates and type** (statutory, associate, secondary, visiting member) on the
  record, passed on to CRISalid.
- **More accurate statuses**: a person employed by another organisation is **External** even
  with an account at the institution; emeritus staff have a grade of their own; a retired
  person without emeritus status is **Left**. See
  [Statuses of people](/en/donnees/statuts-des-personnes/).
- **Duplicates**: field-by-field merge wizard, restorable merge log, qualification of people
  attached to several laboratories.
- **Researcher record**: photo and IdHAL number can be edited.

### Identifiers

- **A single “Researcher identifier alignment” page** for IdRef, ORCID, HAL, OpenAlex and
  Scopus: one row per person, one column per identifier, only the records that need an
  action. See [Align a lab's identifiers](/en/guides/identifiants/aligner-les-identifiants/).
- **New sources**: ORCID, HAL, OpenAlex author profiles (several per person) and Scopus
  Author ID.
- **Mixed identity**: report a profile that mixes up several people, to have it corrected at
  the source; Druid also flags suspicious cases.
- **IdRef records replaced** by ABES: the number is updated in one click.
- **“No research duty” tab** for the staff concerned.
- **LDAP alignment** in two tabs: find missing, check existing ones.

### Structures

- A team's **parent laboratory** is derived from its memberships.
- Creating structures and **Lifecycle and lineage** tab.

### Dashboard

- **Collaborations with a university alliance** (EUniWell): review by university, researchers
  involved, thematic analysis. See
  [Analyse collaborations](/en/guides/tableau-de-bord/collaborations/).
- **Disciplinary profile of teams** by topic, as a heat map.
- **Collaborations with the other laboratories of the institution** also take into account the
  co-authors' memberships in the CRISalid graph, not only their signatures. See
  [Publications and attribution](/en/donnees/publications-attribution/#collaborations).
- **ETL console** built into Druid (technical administrators), with OpenAlex affiliation
  checks.

### Reports

- **My reports**: saved, editable and shareable bibliometric reports, made of charts, key
  figures, texts and publication lists, exported as PDF. See
  [Create a report](/en/guides/rapports/creer-un-rapport/).
- **Two-click templates**: structure report, international collaborations, collaboration with
  a university or group, funding analysis, journals and publishing policy. See
  [Report templates](/en/guides/rapports/modeles/).
- **Add to a report** from the toolbar of every dashboard chart.
- **Sharing** with colleagues or with the whole instance, PDF history and archive. See
  [Share a report](/en/guides/rapports/partager-un-rapport/).
- **AI-written texts**, reviewed before printing: summary and analysis by major theme. See
  [Write the texts with AI](/en/guides/rapports/textes-ia/).

### Interface

- **Druid in English**: FR / EN switch in the top bar.
- **Administration section**: ETL console, access rights, media sources.
- **Rights**: an account without any specific right automatically sees its own laboratory.
- **New logo** and a page header that shrinks as you scroll.
