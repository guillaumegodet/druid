---
title: "Make a laboratory's directory reliable before sending it to CRISalid"
description: "Complete walkthrough: statuses, affiliations, duplicates, identifiers, then export to SoVisu+."
sidebar:
  order: 1
---

:::note[In short]
- **Goal:** make a laboratory's list of members accurate (who is there, in which team, with
  which identifiers) before sending it to CRISalid, which will harvest their publications.
- **For:** central services, with a Druid administrator for duplicates.
- **Time:** half a day for a laboratory of 100 people, plus the laboratory's response time.
- **You need:** an up-to-date list of members, provided by the laboratory (management or
  administration), ideally with e-mail or account username.
:::

CRISalid harvests the publications **of the people Druid sends it**, with **their
identifiers**. A person who has left but is still “Internal”, a person who is present but
missing from the directory, a missing ORCID: so many publications lost or wrongly attributed.
This walkthrough puts the guides in the right order.

## Step 1 — Take stock

1. In **People**, filter on the laboratory (**Lab (primary affil.)**).
2. Note the number of records, then switch to the **Charts** view: breakdown by status,
   identifier coverage. Keep these figures: they will help measure progress.
3. Filter **Validation › Not validated**: these are the records to handle first.

See [Search and filter staff](/en/guides/personnes/rechercher-filtrer/).

## Step 2 — Sort out duplicates

A person present twice distorts all the counts. In **People › To process › Duplicates**,
handle the laboratory's groups:

- **Same lab** and **Holding area**: merge;
- **Several labs**: qualify (concurrent or successive).

See [Handle a duplicate](/en/guides/personnes/traiter-un-doublon/). Reserved for Druid
administrators: otherwise, send the list to [support](/en/guides/support/).

## Step 3 — Link the records to the institution's directory

*If your instance is connected to an LDAP directory.*

1. **Alignment tools › LDAP alignment › Find missing**: link records without a uid to their
   account.
2. **Check existing ones**: carry over the directory's changes (grades, dates) and look at
   the laboratory's **Orphans**: they are often departures.

See [Align with the LDAP directory](/en/guides/identifiants/aligner-ldap/).

## Step 4 — Compare with the laboratory's list

Compare the laboratory's list with Druid's, person by person:

| Situation | What to do |
|---|---|
| Present in both, record correct | Nothing: it will be validated in step 5. |
| Present in Druid, **left** according to the lab | Fill in the **membership end** and the **employment end** (**→ employment end** button). |
| Present in Druid, **employed by a research organisation** (CNRS, Inserm…) | Fill in the **Employing institution**: they will become External. |
| Wrong **team** or wrong **primary affiliation** | Correct the **Affiliations & history** card. |
| Missing from Druid | Ask for their record to be created (**New** button, technical administrators). |

An approximate date is enough: `2025` or `2025-09` (see
[Enter imprecise employment dates](/en/guides/personnes/dates-imprecises/)).

## Step 5 — Validate the records

Once the records are corrected, validate them **with the laboratory's list as the source**:

- in bulk with **People › Synchronise › Import a validated list** (source: “Lab list,
  September 2026”, scope: status and affiliation);
- or record by record with **Validate the record**.

Handle by hand the **homonyms** and the rows **not found** reported by the import. See
[Correct a person's status or affiliation](/en/guides/personnes/fiabiliser-statut-rattachement/).

:::tip[Checkpoint]
Filter the laboratory again with **Validation › Not validated**: only records deliberately
left aside (former members, for example) should remain.
:::

## Step 6 — Complete the identifiers

Follow the tutorial [Complete a laboratory's identifiers from A to Z](/en/tutoriels/identifiants-labo-a-z/).
It is the longest step, but the most useful for CRISalid: without an identifier, a person is
only found by name.

## Step 7 — Send to CRISalid

*If your instance allows the export to CRISalid.*

1. Open **Administration** and click **Synchronise with SoVisu+**: Druid regenerates the list
   of structures, then the list of researchers (identifiers, primary structure, dates), both
   sent to CRISalid.
2. Check the date of the last export shown under the button.

CRISalid takes the new list into account at its next run (usually the following day), then
harvests the publications over the following days.

## Step 8 — Check the result

A few days later:

- in SoVisu+, the laboratory's members appear with their publications;
- in the laboratory's dashboard, the **Sources** tab shows the share of publications found
  by CRISalid;
- the **Headcount** scope now recognises the validated members (after the dashboard is
  regenerated).

## Summary

- [ ] The laboratory's duplicates handled
- [ ] Records linked to the LDAP directory (if available)
- [ ] Departures, employers, teams and affiliations corrected
- [ ] Records validated with the laboratory's list as the source
- [ ] Identifiers completed
- [ ] List sent to CRISalid
- [ ] Result checked in SoVisu+ and in the Sources tab

## What next

Validation lasts **18 months**: plan the same review every year, for example at the start of
the academic year. Records whose validation has **Expired** come up with the **Validation**
filter.

## See also

- [Statuses of people](/en/donnees/statuts-des-personnes/)
- [Memberships and affiliation](/en/donnees/appartenances-rattachement/)
