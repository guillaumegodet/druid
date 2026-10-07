---
title: "Publications and attribution"
description: "How a publication is linked to a researcher and to a structure."
sidebar:
  order: 6
---

## What it is

The dashboard of a structure relies on two operations:

1. **building the corpus**: finding the structure's publications in bibliographic
   databases;
2. **recognising the authors**: for each publication, identifying which of its authors are
   members of the structure, and of which team.

## How the corpus is built

For each structure, the processing chain (ETL) queries several sources:

| Source | How the structure is found there |
|---|---|
| **OpenAlex** | Through the structure's OpenAlex identifier: a publication is included if one of its authors is affiliated with the structure or one of its sub-entities. |
| **French Open Science Monitor (BSO)** | Through the structure's identifiers and affiliation keywords (RNSR, acronym). |
| **HAL** | Through the structure's HAL collection. |
| **CRISalid graph** | Through the publications harvested for the structure's researchers, thanks to their identifiers. |

Publications with the same DOI are **merged**; in case of disagreement, BSO data prevail for
open access.

A publication is therefore in the corpus because **at least one author signs with the
structure's affiliation**, or because it was harvested for one of its members.

## How authors are recognised

The list of a structure's **members** comes from the directory: they are the structure's
**validated** records, excluding people who are leaving.

For each author of a publication, Druid compares their name with the members' names:
**surname** and **first initial**, taking into account particles (*de*, *Le*, *El*…),
accents and compound names. If several members match, priority goes to permanent staff, then
to associate members, then to PhD students.

A recognised member brings their **teams**: a publication is counted in **each team** of
each of its member authors. A publication written by two teams therefore counts once for
each, but only once for the structure.

## The two scopes of the dashboard

At the top of the dashboard, the scope selector offers two views:

| Scope | Publications kept |
|---|---|
| **Affiliation** | All publications of the corpus, i.e. signed with the structure's affiliation. |
| **Headcount** | Only those with **at least one author recognised** among the members. The number of publications left out is shown on hover. |

*Affiliation* answers the question “what has the structure published?”, *Headcount* answers
“what have its current members published under this affiliation?”. A large gap between the
two often points to records that are not validated, members missing from the directory, or
wrong affiliations in the databases.

## Federations and institutions

In OpenAlex, an institution can be attached to several “parents”. Some research federations
or laboratories with several supervising bodies are attached there to **all their
supervising bodies**, including institutions where they have almost no members. Without
precautions, their publications would be counted for each of these supervising bodies.

Druid keeps an **exclusion list**: for these institutions, the link to the parents is
ignored, and a publication with no genuinely local author is left out of the corpus.

For **composite structures** (an institution grouping several laboratories), each
publication is also attributed to the internal laboratory or laboratories of its authors,
based on their affiliations.

## Collaborations

The collaboration type of a publication is derived from its **co-authors** and their
institutions:

| Type | Condition |
|---|---|
| **Within the structure** | Authors from several internal laboratories of a composite structure. |
| **With another laboratory of the institution** | A co-author from another laboratory of the same institution. |
| **National** | A co-author from a French institution outside the institution. |
| **International** | A co-author from a foreign institution. |
| **No collaboration** | A single author, or only authors from the structure. |

A publication can combine several types. The co-affiliations of the same author with their
supervising bodies do not count as a collaboration.

The **countries** of a publication combine the affiliation countries given by each source
(OpenAlex, HAL, BSO) and those of the co-signing foreign institutions. Until 7 October 2026, a
single source was kept and some countries were missing: the international figures rose on that
date.

On instances connected to the CRISalid graph, **another laboratory of the institution** is
also recognized when a co-author is a **member** of it according to the directory, even if
their signature does not mention it (for instance a clinician who signs « CHU Nantes »). The
current membership counts: a co-author who moved to another laboratory is attached to the new
one. The institution sub-tab shows how many publications are found only this way.

## Signature charter

The **Signature charter** tab compares the affiliation written by the authors with the form
recommended by the institution: exact mention of the institution, name or acronym of the
structure, unit code, address, required supervising bodies. Each publication gets a score;
it is **compliant** if the institution is mentioned and the score reaches the chosen
threshold.

## Known limitations

- **Namesakes**: recognition by name and initial can confuse two people with the same
  surname and the same initial in the same structure.
- **Members not validated**: a record that is not validated is not a member; its
  publications fall outside the *Headcount* scope.
- **Former members**: the *Headcount* scope relies on the **current** list of members. The
  publications of a person who has left no longer appear there, even if they date from their
  time in the structure. For a multi-year report, prefer the *Affiliation* scope.
- **Wrong affiliations in OpenAlex**: OpenAlex sometimes attributes a publication to the
  wrong institution. These errors can be spotted and reported from the ETL console (see
  [An affiliation is wrong](/en/guides/corriger/affiliation-fausse/)).
- **Multi-site laboratories**: a unit with several supervising bodies also counts the
  publications of its members attached to other institutions.
- **Publications without a DOI**: harder to deduplicate, they can appear twice if they come
  from two different sources.

## How to report an error

See [A publication is missing or wrongly attributed](/en/guides/corriger/publication-manquante/)
and [An affiliation is wrong](/en/guides/corriger/affiliation-fausse/).
