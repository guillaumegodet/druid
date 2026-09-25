---
title: "Researcher identifiers"
description: "What each identifier (IdRef, ORCID, IdHAL, OpenAlex, Scopus) represents and how Druid suggests candidates."
sidebar:
  order: 5
---

## What it is

A **researcher identifier** links a person to their profile in an external database. They are
what allows CRISalid to **harvest the publications** of each researcher: without an
identifier, a person can only be found by name, which mixes up namesakes.

## Each source

| Identifier | Who creates and manages it | What it is for |
|---|---|---|
| **IdRef** (PPN) | Libraries (ABES network) | French national authority file for authors: theses, library catalogues. Reliable, but not everyone has a record. |
| **ORCID** | The researcher themselves | International identifier, requested by publishers and funders. Only the person can edit their profile. |
| **IdHAL** | The researcher, in HAL | Links an author's HAL deposits, whatever the form of their name. Druid also stores its internal number. |
| **OpenAlex** (A-id) | Calculated automatically by OpenAlex | Author profile built by an algorithm. **A person can have several profiles**: a main one and fragments. |
| **Scopus Author ID** | Calculated automatically by Elsevier | Author profile of the Scopus database, also built by an algorithm. |

On an instance connected to an LDAP directory, the directory's **uid** is also an
identifier: it is aligned separately (see
[Align with the LDAP directory](/en/guides/identifiants/aligner-ldap/)).

## How Druid finds candidates

For each record missing an identifier, Druid **queries the source** by the person's name,
then **looks for evidence** that the profile found is really theirs.

### Confidence levels

| Level | Typical evidence | What to do |
|---|---|---|
| **strong** | An identifier already on the record is found on the profile (the record's ORCID on the HAL profile, the IdRef on the ORCID profile…), or exact name and affiliation with the record's institution or laboratory. | Validate, in bulk if needed (**Check all strong candidates**). |
| **medium** | Matching name and affiliation with the institution or the laboratory, but no shared identifier. | Open the profile and check (topics, co-authors) before validating. |
| **weak** | Namesake, with no evidence of affiliation. | Only after a manual check. |

The exact evidence depends on the source:

- **IdRef**: exact name, scientific person, plausible dates of birth and death. On some
  instances, the CRISalid graph refines the choice between namesakes.
- **ORCID and HAL**: cross-referenced identifiers (ORCID, IdRef, Scopus, e-mail) and
  affiliation with the institution or the laboratory.
- **OpenAlex**: publications shared with the person's HAL or CRISalid corpus, affiliation
  with the laboratory. The profile holding the record's ORCID is stored directly.
- **Scopus**: the record's ORCID on the profile, or exact name with affiliation with the
  institution or the laboratory. A single namesake without evidence is never suggested as
  certain.

### Situations of a record

| Situation | Meaning |
|---|---|
| **strong candidate** | An almost certain suggestion, which can be ticked directly in the row. |
| **candidates to check** | One or more medium or weak suggestions. |
| **Ambiguous — decide** | Several plausible candidates: you have to choose, or ignore. |
| **conflict** | The record already holds an identifier different from the one found. |
| **replaced entry** | The record's IdRef points to an authority record merged or deleted by ABES: **Update** replaces it with the new one. |
| **Suspected mixed identity** | Some clues suggest that the profile mixes up several people. |
| **empty record** | The ORCID profile exists but shows no public data: impossible to confirm. |

The **Researcher identifier alignment** page **only lists the records that need an action**:
a record that is already complete, or for which nothing was found, does not appear there.

### The three groups of the page

| Tab | Who |
|---|---|
| **Staff** | Academics, researchers and other research staff. |
| **PhD students** | PhD students. |
| **No research duty** | Staff with no statutory research duty: they can have identifiers, but it is a low priority. |

## What Druid does with your decision

- **Validate** writes the identifier to the directory, with the date and the source. Druid
  **only fills empty fields**: it never overwrites an existing identifier (that is a
  conflict).
- For **OpenAlex**, validating **adds** the profile to the person's list: nothing is
  removed.
- **Wrong candidate** puts the (person, identifier) pair on a **blacklist**: it will never be
  suggested again.
- **Mixed identity** opens a report: the profile is neither validated nor rejected, is never
  exported, and the correction is made **at the source** (see below).

Validated identifiers go to CRISalid at the next export, and are then used to harvest
publications.

## Automatic updates

Druid regularly reruns some searches, depending on your instance's configuration. For
example, OpenAlex profiles can be rechecked every quarter: a profile merged by OpenAlex is
replaced by the new one, a profile that has disappeared is removed.

## Known limitations

- **Namesakes** remain the main source of errors, especially for common names and profiles
  without an affiliation.
- **Name changes** (marriage, name in use, transliteration) lower the score of a good
  candidate.
- **Algorithmic profiles** (OpenAlex, Scopus) can mix up several people or split one person
  into several profiles. Druid does not fix them: it flags them.
- **No search without an exact name**: a record with a misspelt name does not find its
  candidate.
- **API quotas**: Scopus and OpenAlex limit the number of requests. A large laboratory can
  take several days of searching.
- **Reruns from Druid** depend on the instance: on some, searches are only started by the
  technical team.

## How to report an error

A wrong identifier in Druid is corrected on the record. An error **in the source** is
corrected there, by the right person:

| Source | Who corrects |
|---|---|
| IdRef | The library (ABES cataloguing rights) |
| HAL | The author (“My IdHAL”), otherwise the laboratory's HAL contact |
| OpenAlex | The author through the curation of their profile, otherwise OpenAlex support |
| ORCID | The person alone |

See [Where to fix what](/en/guides/corriger/ou-corriger-quoi/) and
[Follow up “To process” tasks](/en/guides/personnes/taches-a-traiter/).
