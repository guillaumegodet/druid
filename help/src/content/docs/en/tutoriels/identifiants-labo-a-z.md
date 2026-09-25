---
title: "Complete a laboratory's identifiers from A to Z"
description: "Complete walkthrough of IdRef, ORCID, HAL, OpenAlex and Scopus alignment for a structure."
sidebar:
  order: 3
---

:::note[In short]
- **Goal:** every researcher of a laboratory has their IdRef, ORCID, IdHAL, OpenAlex and
  Scopus identifiers, and errors in external databases are reported.
- **For:** central services (library, research office).
- **Time:** one to two days for a laboratory of 100 people, spread over a week (search time,
  API quotas, researchers' replies).
- **You need:** a reliable directory of the laboratory (see
  [Make a laboratory's directory reliable](/en/tutoriels/fiabiliser-annuaire-labo/)).
:::

Identifiers reinforce each other: an ORCID found on an IdRef record makes a HAL profile
holding the same ORCID certain. The order of the sources matters.

## Step 1 — Measure the starting point

In **People**, filter the laboratory and switch to the **Charts** view: the **Identifier
coverage** chart gives the share of records holding each identifier. Note it down.

## Step 2 — Check the existing identifiers

Before looking for missing ones, make sure the existing ones are right.

1. Open **Alignment tools › Researcher identifier alignment** and choose the laboratory.
2. Select **Check existing ones**, then **Search everywhere**.
3. Handle the **Name mismatches / replaced entries**: **Update** the IdRef records merged by
   ABES, confirm or detach the name mismatches.
4. Handle the **Conflicts**: a wrong existing identifier is corrected on the record.

## Step 3 — Search for missing identifiers

1. Select **Find missing**, then **Search everywhere**. Let the search run (from a few
   minutes to more than an hour).
2. Start with the **Staff** tab; **PhD students** and staff with **No research duty** come
   next.

## Step 4 — Validate the strong candidates

1. Click the **Candidates to check** counter.
2. Quickly go through the list, then **Check all strong candidates**. Records marked ⚡
   already share an identifier with the suggested profile.
3. Click **Apply**.

Run **Search everywhere** again: the identifiers you have just written often produce other
strong candidates (a validated ORCID confirms a HAL or Scopus profile).

## Step 5 — Decide on the remaining cases

For each **candidates to check** or **Ambiguous — decide** badge:

1. Open the suggested profile: topics, co-authors, institutions.
2. Tick the right candidate, **Ignore** if in doubt, **Wrong candidate** for a namesake.
3. **Apply** regularly, so as not to lose your work.

For **OpenAlex**, a person can have several profiles: validate **all** those that are theirs
(the main one and the fragments).

See [Accept, reject or ignore a candidate](/en/guides/identifiants/accepter-rejeter-candidat/).

## Step 6 — Report errors at the source

Some problems cannot be solved in Druid:

| Problem | Action |
|---|---|
| Profile mixing two people | **Mixed identity**, then a correction request at the source |
| Two ORCIDs, two IdHALs, two Scopus profiles for one person | Task with **Email to the researcher** |
| No ORCID and no IdHAL | Task inviting them to create one (**Email to the researcher**) |
| IdRef record to correct or create | Task for the **Authorities correspondent (IdRef)** |

See [Follow up “To process” tasks](/en/guides/personnes/taches-a-traiter/). Many of these
tasks are in fact created automatically.

## Step 7 — Enrich the IdRef records

Druid now knows ORCIDs and IdHALs missing from IdRef records. Filter the laboratory in
**People**, then **Export › ABES export (IdRef)**: the workbook produced is to be sent to ABES
or handled by the library. See [Export a file for ABES](/en/guides/identifiants/export-abes/).

## Step 8 — Measure the result and send to CRISalid

1. Go back to the **Charts** view: compare the identifier coverage with that of step 1.
2. Send the list to CRISalid (**Administration › Synchronise with SoVisu+**, if your instance
   allows it).

## Summary

- [ ] Initial coverage noted
- [ ] Existing identifiers checked (replaced entries, mismatches, conflicts)
- [ ] Strong candidates validated, then a new search
- [ ] Ambiguous cases decided, wrong candidates discarded
- [ ] Mixed identities and duplicate identifiers reported (tasks)
- [ ] ABES export sent
- [ ] Final coverage measured, list sent to CRISalid

## What next

Researchers create new profiles, OpenAlex merges others: run **Check existing ones** and
**Find missing** again two or three times a year. On some instances, part of these checks is
automatic.

## See also

- [Researcher identifiers](/en/donnees/identifiants-chercheurs/)
- [Align a lab's identifiers](/en/guides/identifiants/aligner-les-identifiants/)
