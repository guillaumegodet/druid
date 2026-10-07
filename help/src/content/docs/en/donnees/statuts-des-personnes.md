---
title: "Statuses of people"
description: "The three pieces of information that replace Internal / External: presence in the unit, employer and LDAP account — how Druid calculates them and how manual validation overrides them."
sidebar:
  order: 2
---

## What it is

Since October 2026, Druid no longer sorts people into “Internal / External”. That status
mixed up three different questions. Every record now carries **three independent pieces of
information**:

| Information | Values | What is authoritative |
|---|---|---|
| **Presence** in the unit | **Present**, **Leaving** (end announced), **Left** | The end dates, validated lists and, for the institution's staff, the LDAP directory |
| **Employer** | The institution, another organisation (CNRS, Inserm, university hospital, another school…) or not specified | The record's **Employer** field |
| The institution's **LDAP account** | Active, closing, none | The LDAP directory, as is |

Example: a CNRS researcher hosted in one of the university's laboratories is **Present**, her
employer is **CNRS**, and she has an **active LDAP account**. These three pieces of
information no longer contradict each other.

The **Internal staff** shortcut of the list combines two of them: people who are **present**
and **employed by the institution**.

:::note[Depending on your instance]
Presence and validation depend on the “Statuses and manual validation” feature. On an
instance where it is disabled, they do not appear. The LDAP account only appears on an
instance connected to an LDAP directory. See
[Instances and features](/en/donnees/instances-fonctionnalites/).
:::

## The employer

The employer comes from the record's **Employer** field, entered in Druid or taken from a
list (laboratory, human resources). The LDAP directory does not give it directly: it shows
the institution for every account, including those of hosted researchers from research
organisations. Druid nevertheless deduces the employer in the clear-cut cases, for example
when a record is created with **Fill from LDAP**:

- tenured or contract staff of the institution with a known corps: **the institution**;
- account opened by the CNRS hosting tool: **CNRS**;
- accounts hosted for another organisation, PU-PH, sessional lecturers: **not deduced**, to be
  entered.

## The LDAP account

A record has an LDAP account when its **uid** is a real directory identifier (not a dummy
`ext_…` uid) and the directory knows it:

| Account | Meaning |
|---|---|
| **Active** | The account exists and works. |
| **Closing** | The directory announces its closure (scheduled departure, end of hosting). |
| **None** | No uid, dummy `ext_…` uid, or account unknown to the directory. |

An `ext_…` record whose person actually has an account (found by their staff number) gets a
**Switch to the LDAP uid** task. See
[Tasks to handle](/en/guides/personnes/taches-a-traiter/).

## How presence is calculated

Druid applies the following rules, in this order.

### 1. Certain departure

If the **employment end** and the **end of membership** of the laboratory are both filled in
**and in the past**, the person is **Left**, whatever the LDAP directory says and even over a
validation. A date entered as a year only (`2026`) is only “past” once the whole year is
over, i.e. from 1 January 2027.

### 2. Manual validation

If the record has been **validated** for its status, the validated presence prevails over the
following rules. See [Manual validation](#manual-validation).

### 3. Retirement

A person classified as **retired** by human resources, **with no trace of emeritus status**,
is **Left**. See [Emeritus and retired staff](#emeritus-and-retired-staff).

### 4. The LDAP directory, for the institution's staff

When the employer is the institution or is not specified, and the record has a real uid:

| What the LDAP directory says | Presence |
|---|---|
| Active account | **Present** (unless rule 5 applies) |
| Scheduled departure (account closing) | **Leaving** |
| The account no longer exists | **Left** |

For **another employer**, the LDAP directory does not count: a hosted account that closes
often signals the end of a hosting agreement, not a departure from the laboratory. Druid then
creates a **Hosted LDAP account closing: probable departure?** task so that someone checks.

### 5. Employment end dates

- Employment end **in the past**: **Left**.
- Employment end within the **next 3 months**: **Leaving** (end announced). For an imprecise
  date, the end of the period is what counts: `2027` is only an announced end from
  October 2027.

### 6. Otherwise

The person is **Present**.

:::note[Going further]
Rules implemented in `lib/presence.ts` (presence, LDAP account, employer),
`lib/validation.ts` (validation), `lib/emeritus.ts` (emeritus status), `lib/dates.ts` (dates)
and `lib/ldapEmployer.ts` (employer deduced from LDAP) of the Druid repository.
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

An emeritus keeps the presence given by the LDAP directory (most often **Present**).
Conversely, a **retired person without emeritus status** becomes **Left**.

## Manual validation

Automatic sources are imperfect: the LDAP directory is updated late, and the employment
dates of external people are incomplete. When you have reliable information (a list sent by
a laboratory, a direct check), you **validate the record**.

A validation records:

- what it covers: the **status** (the presence), the **affiliation**, or both;
- the **validated presence**: Present, Leaving or Left;
- the **source** (for example “Lab list, June 2026”) and the **date**;
- the author of the validation.

Validation does **not** cover the employer: to say that a person belongs to the CNRS, fill in
their employer. “Internal” and “External” validations recorded before October 2026 both count
as **Present**.

It is done record by record (**Validate the record** on the researcher record) or in bulk
(**Import a validated list**, **Synchronise** menu of People). See
[Correct a person's status or affiliation](/en/guides/personnes/fiabiliser-statut-rattachement/).

### Validation badges

| Badge | Meaning |
|---|---|
| **Validated** | The record is validated; the source and date appear on hover. |
| **Expired** | The validation is more than **18 months** old: it still applies, but it needs reviewing. |
| **Validated — conflict** | The automatic calculation gives a presence other than the validated one (for example, the LDAP directory announces a departure). The presence shown remains the validated one: it is up to you to decide. |

### Why it matters

Validated records are the ones counted as **members** of a laboratory in the dashboard
(*Headcount* scope, see
[Publications and attribution](/en/donnees/publications-attribution/#the-two-scopes-of-the-dashboard)).
A record that is not validated is not taken into account in this scope.

## Example

A CNRS researcher works in one of the university's laboratories and has an active account
there. Her record gives “CNRS” as employer: she is **Present**, employer **CNRS**, LDAP
account **active**. Her hosted account then starts closing: her presence does not change, but
a task asks someone to check with the laboratory. The laboratory confirms her departure: her
employment end and end of membership are filled in, and she becomes **Left** (rule 1).

## Known limitations

- **The employer must be filled in**: a record without an employer follows the LDAP directory
  like the institution's staff, and is not included in the **Internal staff** shortcut.
- **The LDAP directory lags behind**: a departure sometimes only shows up there after several
  months. In the meantime, the person stays Present, unless validated or unless end dates are
  filled in.
- **External people without an end date** stay Present indefinitely: only an employment end
  date (or a validation) makes them Left.
- **A validation does not update itself**: if the situation changes, the validated record
  keeps its presence until someone reviews it. The **Validated — conflict** badge flags the
  cases where the LDAP directory says otherwise.
- **Past end dates override everything**: an employment end and an end of membership entered
  in the past by mistake make the record Left, even when validated.

## How to report an error

Does a presence or an employer look wrong? First check the employer and the dates on the
record, then see [Where to fix what](/en/guides/corriger/ou-corriger-quoi/). For an error in
the LDAP directory, human resources make the correction.
