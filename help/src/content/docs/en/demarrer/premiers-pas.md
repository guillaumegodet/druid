---
title: "First steps for your profile"
description: "What you see and can do in Druid depending on your profile: lab member or lab management, central services, administration."
sidebar:
  order: 2
---

Druid does not show the same things to everyone. What you see depends on two things: **your
profile** (the rights granted to your account) and **your instance** (the features enabled in
your institution's Druid, see [Instances and features](/en/donnees/instances-fonctionnalites/)).

## How your profile is determined

You log in with your institution account. Druid then reads the rights attached to that
account:

- **without any specific right**, you are a *laboratory member*: Druid finds your laboratory
  through **your own record** in the directory. If you have no record, or if it does not
  mention a laboratory, you will not see any data;
- **with a right granted** by an administrator (lab management, central services,
  administration…), your scope is the one of that right.

Rights add up: you can for example be both an administrator and a communication officer.

## Laboratory member

You see the data **of your laboratory or laboratories**:

- **People**: the list of your lab's members, their records, the charts;
- **Dashboard**: your lab's publications and indicators.

Where to start:

1. Open **People** and check [your own record](/en/guides/personnes/lire-une-fiche/): status,
   laboratory, team, identifiers.
2. Open the **Dashboard** and browse your lab's **Overview**
   ([choose a structure, a period, a scope](/en/guides/tableau-de-bord/structure-periode-perimetre/)).
3. Found a mistake? See [Where to fix what](/en/guides/corriger/ou-corriger-quoi/).

## Laboratory management

Same scope as members (your laboratories), but **granted explicitly**: it does not depend on
your own record. This is the profile of unit directors and of the administrators who follow
one or several labs.

Where to start:

1. In **People**, go through your lab's list and spot the records to correct (people who
   have left, missing team): see
   [Correct a person's status or affiliation](/en/guides/personnes/fiabiliser-statut-rattachement/).
2. In the **Dashboard**, compare the **Affiliation** and **Headcount** scopes to check that
   your members' publications are properly recognised.
3. For an evaluation report: [Prepare the bibliometric part of an evaluation report](/en/tutoriels/bilan-bibliometrique/).

## Central services

Research office, libraries, strategic planning, vice-presidencies: you see **the whole
institution**. On top of People and the Dashboard, you have access to:

- **Structures**: the description of laboratories, teams and faculties;
- **Alignment tools**: completing researcher identifiers (IdRef, ORCID, HAL, OpenAlex,
  Scopus) and, depending on the instance, the alignment with the LDAP directory.

Where to start:

1. [Align a lab's identifiers](/en/guides/identifiants/aligner-les-identifiants/).
2. [Make a laboratory's directory reliable](/en/tutoriels/fiabiliser-annuaire-labo/), the
   complete walkthrough.

## Druid administrators

Everything central services see, plus:

- **Groups**: create selections of researchers and their dashboard;
- **To process** (in People): duplicates to merge and correction tasks to carry out outside
  Druid (the button only appears if you are also a technical administrator);
- **Report a correction** on a record;
- **Administration › Access rights** (read only), if your instance allows it.

See [Handle a duplicate](/en/guides/personnes/traiter-un-doublon/) and
[Give rights to a user](/en/guides/administration/donner-des-droits/).

## Technical administrators

Profile reserved for the team that runs Druid: **ETL console** (regenerating the
dashboards), hidden tabs of the dashboard. Combined with a right on the whole institution, it
also gives the **Synchronise** menu of People (including **Import a validated list**, to
validate a lab's records at once from a trusted list) and the **New** button (create a
record). See [Run the ETL console](/en/guides/administration/console-etl/).

## Communication officers

Access to **Administration › Media sources**, to choose the media followed by the news
watch, and to the **Watch** tab of the dashboard. See
[Manage media sources](/en/guides/veille/sources-medias/).

## Requesting additional access

If a section is missing or you do not see the right laboratory:

1. First check **your record** in People: a lab profile depends on the laboratory it
   mentions.
2. Otherwise, ask your institution's Druid administrator for the appropriate right, stating
   the laboratory or laboratories concerned: see [Support](/en/guides/support/).

## See also

- [Druid in 5 minutes](/en/demarrer/druid-en-5-minutes/)
- [Instances and features](/en/donnees/instances-fonctionnalites/): rights in detail
