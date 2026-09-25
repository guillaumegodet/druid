---
title: "Memberships and affiliation"
description: "Membership of a lab or a team, primary affiliation, membership types and imprecise dates."
sidebar:
  order: 3
---

## What it is

Druid distinguishes two things that are often confused:

- **employment**: the employment contract, with an employer, a grade and dates (**Employment
  & contract** card of the record);
- **membership**: being a member of a laboratory or a team, with its own dates
  (**Affiliations & history** card of the record).

The two do not always coincide. An associate professor can move to another laboratory
without changing employer. A PhD student can be attached to a laboratory before her contract
starts. A CNRS researcher is employed by the CNRS but belongs to a university laboratory.

## Primary affiliation

A person can belong to several structures. One of them is the **primary affiliation**
(purple badge in the Memberships card):

- it is the structure to mention first in the **affiliation** of publications;
- it is the one passed on to **CRISalid** as the person's research structure;
- it determines in which laboratory the person appears by default in lists and in the
  dashboard.

The other memberships are shown with a label:

| Label | Meaning |
|---|---|
| **secondary** | Concurrent membership of another structure, ongoing. |
| **former** | Former membership, now ended (the person moved to another laboratory). |

These labels come from the qualification of multiple records: see
[Handle a duplicate](/en/guides/personnes/traiter-un-doublon/).

## Membership types

The **type** specifies the nature of the link with the structure. Druid uses the CRISalid
vocabulary:

| Type (Druid label) | When to use it |
|---|---|
| **Statutory member** | Full member, statutorily attached to the unit. This is the default. |
| **Associate member** | Contributes to the unit's work without being statutorily attached to it. |
| **Secondary affiliation** | Primary member of another unit, also attached to this one. |
| **Visiting member** | Temporary presence (visiting researcher, research stay). |

A type left empty is treated as **Statutory member** when exporting to CRISalid.

## Imprecise dates

The exact date of an arrival or a departure is not always known. The four dates of the
record (employment start and end, membership start and end) therefore accept three levels
of precision:

| What you know | What to enter | Displayed |
|---|---|---|
| The year | `2022` | 2022 |
| The month | `2022-09` | 09/2022 |
| The day | `2022-09-01` | 01/09/2022 |

The French forms `01/09/2022` (day/month/year) and `09/2022` are also accepted and converted
automatically. An unreadable entry stays red and is not saved.

When a precise date is needed (export to CRISalid, calculation of a departure), Druid takes
the **bound of the period**: the first day for a start date (`2022` → 1 January 2022), the
last day for an end date (`2026-06` → 30 June 2026).

The **→ employment end** button, next to the membership end date, copies that date as the
employment end in one click: the most common case when a person leaves the institution.

See [Enter imprecise employment dates](/en/guides/personnes/dates-imprecises/).

## What the dates change

- **The status**: a past employment end **and** a past membership end make the person
  **Left**, even if their record is validated (see
  [Statuses of people](/en/donnees/statuts-des-personnes/#6-certain-departure)). For a person
  without an account at the institution, the employment end alone is enough.
- **The export to CRISalid**: the dates of the primary membership are passed on, which makes
  it possible to date the harvested publications.
- A period is only “past” once it is **entirely** over: an end of `2026` counts from
  1 January 2027.

## Example

A lecturer moves to another laboratory in September 2025, without changing employer. Her
Employment card stays as it is and, in the Memberships card:

- the former laboratory gets a membership end of `2025-08` and becomes **former**;
- the new laboratory, with a start of `2025-09`, becomes the **primary affiliation**.

Her status remains **Internal**, since her employment continues.

## Known limitations

- **Membership dates are often empty**: they only exist since 2026 and were not filled in
  for older records. A membership without an end date is considered ongoing.
- **A membership end alone does not make the person leave**: for a person employed by the
  institution, a past employment end (or an account closed in the LDAP directory) is also
  needed.
- **There is only one primary affiliation**: a person genuinely split equally between two
  units must still choose one as primary.
- **The export to CRISalid only passes on the primary membership** and its dates.

## How to report an error

A wrong laboratory, team or date is corrected directly on the record if you have rights on
that laboratory; otherwise see [Where to fix what](/en/guides/corriger/ou-corriger-quoi/).
