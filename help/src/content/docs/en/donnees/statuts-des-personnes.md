---
title: "Statuses of people"
description: "How Druid decides whether a person is Internal, Leaving, Left or External, and how manual validation overrides it."
sidebar:
  order: 2
---

## What it is

Every record has a **status** that tells where the person stands with regard to the
institution:

| Status | Meaning |
|---|---|
| **Internal** | In post at the institution. |
| **Leaving** | Still present, but their departure has been announced. |
| **Left** | No longer here: contract ended, account deleted, retirement… |
| **External** | Member of the laboratory but employed by another organisation (CNRS, Inserm, another school…), or without an account at the institution. |

The status is **calculated automatically** from the LDAP directory and the employment dates.
An authorised person can then **confirm it by hand**: this is validation, which prevails over
the calculation.

:::note[Depending on your instance]
Statuses and validation depend on the “Internal/External statuses and manual validation”
feature. On an instance where it is disabled, they do not appear. See
[Instances and features](/en/donnees/instances-fonctionnalites/).
:::

## How it is calculated

Druid applies the following rules, in this order.

### 1. The employer

If the record's **employer** is known and **different from the institution** (CNRS, Inserm,
university hospital, another school…), the person is **External**, even if they have an
active account in the institution's directory. They become **Left** once their employment
end date has passed.

Why: many researchers from national research organisations have an account hosted by the
university, and the state of that account says nothing about their actual contract.

### 2. The LDAP directory

Otherwise, for a person who has an account (a uid):

| What the LDAP directory says | Status |
|---|---|
| Active account, normal situation | **Internal** |
| Scheduled departure | **Leaving** |
| Other situation (account created in advance…) | **External** |
| The account no longer exists | **Left** |

### 3. People without an account

A person without an account at the institution (empty uid or dummy `ext_…` uid) is
**External**, and becomes **Left** once their employment end date has passed.

### 4. Retirement

A person classified as **retired** by human resources, **with no trace of emeritus status**,
is **Left**, even if their account is still active. See
[Emeritus and retired staff](#emeritus-and-retired-staff).

### 5. Manual validation

If the record has been **validated** for its status, the validated status **replaces** the
result of rules 1 to 4. See [Manual validation](#manual-validation).

### 6. Certain departure

Finally, if the **employment end** and the **end of membership** of the laboratory are both
filled in **and in the past**, the person is **Left**, whatever the LDAP directory says and
even over a validation. A date entered as a year only (`2026`) is only “past” once the whole
year is over, i.e. from 1 January 2027.

:::note[Going further]
Rules implemented in `lib/gristService.ts` (calculation), `lib/validation.ts` (validation),
`lib/emeritus.ts` (emeritus status) and `lib/dates.ts` (certain departure) of the Druid
repository.
:::

## Emeritus and retired staff

Emeritus status can show up in several places: the grade, the type of employment, the
category in the LDAP directory. As soon as one of these sources indicates emeritus status,
Druid assigns an **emeritus grade** based on the original corps:

| Original corps | Emeritus grade |
|---|---|
| Associate professor (MCF, MCF hors classe, MCU-PH) | **MCFEM** |
| Research director (DR, DR1, DR2, DRCE) | **DREM** |
| All others (professors, PU-PH, research fellows, unknown corps) | **PREM** |

An emeritus keeps the status given by the LDAP directory (most often **Internal**).
Conversely, a **retired person without emeritus status** becomes **Left**.

## Manual validation

Automatic sources are imperfect: the LDAP directory is updated late, and the employment
dates of external people are incomplete. When you have reliable information (a list sent by
a laboratory, a direct check), you **validate the record**.

A validation records:

- what it covers: the **status**, the **affiliation**, or both;
- the **validated status** (Internal, Leaving, Left or External);
- the **source** (for example “Lab list, June 2026”) and the **date**;
- the author of the validation.

It is done record by record (**Validate the record** on the researcher record) or in bulk
(**Import a validated list**, **Synchronise** menu of People). See
[Correct a person's status or affiliation](/en/guides/personnes/fiabiliser-statut-rattachement/).

### Validation badges

| Badge | Meaning |
|---|---|
| **Validated** | The record is validated; the source and date appear on hover. |
| **Expired** | The validation is more than **18 months** old: it still applies, but it needs reviewing. |
| **Validated — conflict** | The automatic calculation gives a status other than the validated one (for example, the LDAP directory announces a departure). The status shown remains the validated one: it is up to you to decide. |

### Why it matters

Validated records are the ones counted as **members** of a laboratory in the dashboard
(*Headcount* scope, see
[Publications and attribution](/en/donnees/publications-attribution/#the-two-scopes-of-the-dashboard)).
A record that is not validated is not taken into account in this scope.

## Example

A CNRS researcher works in one of the university's laboratories and has an active account
there. Her record gives “CNRS” as employer: she is **External** (rule 1), not Internal as her
account would suggest. When the laboratory reports that she has moved to another site, her
employment end and end of membership are filled in: she becomes **Left** (rule 6).

## Known limitations

- **The employer must be filled in**: a record without an employer follows the LDAP
  directory. A researcher from a research organisation with no employer on their record can
  therefore appear as **Internal**.
- **The LDAP directory lags behind**: a departure sometimes only shows up there after several
  months. In the meantime, the person stays Internal, unless validated or unless end dates
  are filled in.
- **External people without an end date** stay External indefinitely: only an employment end
  date makes them Left.
- **A validation does not update itself**: if the situation changes, the validated record
  keeps its status until someone reviews it. The **Validated — conflict** badge flags the
  cases where the LDAP directory says otherwise.
- **Past end dates override everything**: an employment end and an end of membership entered
  in the past by mistake make the record Left, even when validated.

## How to report an error

Does a status look wrong? First check the employer and the dates on the record, then see
[Where to fix what](/en/guides/corriger/ou-corriger-quoi/). For an error in the LDAP
directory, human resources make the correction.
