---
title: "Structures"
description: "The model of research structures: levels, identifiers, supervising bodies, hierarchy."
sidebar:
  order: 4
---

## What it is

A **structure** is an entity of the research organisation: an institution, a faculty, a
laboratory, a team. Druid describes all of them with a **common model** (called
“Structures V2”), shared with CRISalid, so that they can be exchanged and linked together.

## The four levels

| Level | Druid label | Examples |
|---|---|---|
| 4 | **Institution** | A university, a school, a research organisation |
| 3 | **Intermediate structure** | A faculty, a cluster, a department, a federation |
| 2 | **Unit** | A laboratory (UMR, UR, EA…) |
| 1 | **Team** | A team within a laboratory |

## A structure's record

It is organised in five tabs:

| Tab | Content |
|---|---|
| **Identification** | Official name, acronym, description, local identifier, level, type (UMR, UR…), RNSR. The parent laboratory or faculty is shown there read-only (see [the derived hierarchy](#the-derived-hierarchy)). |
| **Identifiers & links** | UAI, ROR, ISNI, Wikidata, Scopus identifier, HAL collection, website, bibliographic signature. |
| **Missions & topics** | Primary and secondary mission, campus, ERC panel, HCÉRES fields. |
| **Memberships** | Inclusions and participations (including supervising bodies), with their dates. |
| **Lifecycle and lineage** | Status, creation and closure dates, links with the structures that preceded or followed it. |

## Identifiers

| Identifier | What it is |
|---|---|
| **Local identifier** | The structure's identifier in the institution's reference system. It is the only **pivot** identifier: it links people, structures and CRISalid. It cannot be changed. |
| **RNSR** | French national directory of research structures (ministry). |
| **UAI** | French code of institutions (ministry), used for supervising bodies and employers. |
| **ROR** | *Research Organization Registry*, international identifier of organisations. |
| **ISNI**, **Wikidata**, **Scopus** | Other registries, useful for interoperability and bibliometrics. |
| **HAL collection** | The structure's HAL portal or collection. |

The **bibliographic signature** is the affiliation form the structure's members should use in
their publications.

## Supervising bodies, inclusions and participations

Druid distinguishes two kinds of links between structures, in the **Memberships** tab. A
structure is chosen from the database, or added through its UAI code or ROR identifier when
it is external (a partner organisation, for example).

- an **inclusion** is a **strong** membership: the structure is part of its parent structure
  (a team in its laboratory, a laboratory in its cluster);
- a **participation** is a **weaker** link: a laboratory's supervising bodies, its
  participation in a federation or a network.

Among supervising bodies, the **main supervision** is the reference institution; the others
are **associated supervision** or mere **participations**.

## The derived hierarchy

The **Structures** list shows each team's laboratory, and each laboratory's intermediate
structure. This **parent** is not entered separately: Druid **derives it from the
inclusions**.

- For a team (level 1), the parent is the first unit (level 2) in which it is included.
- For a unit (level 2), it is the first intermediate structure (level 3).
- An **ongoing** inclusion takes precedence over one that has ended.

If no inclusion leads to the parent, Druid shows the value stored previously, if any.

:::note[Going further]
Rule implemented in `lib/structureHierarchy.ts` of the Druid repository.
:::

## Lifecycle

| Status | Meaning |
|---|---|
| **Planned** | Structure being prepared, not yet officially created. |
| **Active** | Existing structure. |
| **Closing** | Transition period before closure. |
| **Closed** | Historical structure, kept for past data. |

When laboratories merge, split or succeed each other, the **Lifecycle and lineage** tab keeps
track of these links (succession, integration, merger, split).

## Where structures come from

- On an instance connected to an **LDAP directory**, the institution's structures can be
  imported and updated from that directory (**Import from LDAP** button of the Structures
  list).
- Otherwise, they are created and completed by hand in Druid.
- They can be sent to CRISalid (**Synchronise with SoVisu+** button), if your instance allows
  it.

## Example

A “Signal” team is included in the “LABO” laboratory, itself included in the “Science and
technology” cluster. The laboratory has two supervising bodies: the university (main
supervision) and the CNRS (associated supervision). In the Structures list, the team shows
“LABO” as its parent, and the laboratory shows the cluster.

## Known limitations

- **A missing inclusion breaks the hierarchy**: a team with no inclusion in its laboratory
  does not appear under it (nor in the filters by laboratory).
- **Intermediate structures are heterogeneous**: faculty, cluster, department or federation
  depending on the institution. The model only tells them apart by their type.
- **Units with several supervising bodies** can include members from other institutions:
  not all their publications are your institution's publications (see
  [Publications and attribution](/en/donnees/publications-attribution/)).
- **External identifiers are not checked automatically**: a mistyped ROR or RNSR is not
  flagged.

## How to report an error

See [View and update a structure](/en/guides/structures-groupes/mettre-a-jour-une-structure/)
or [Where to fix what](/en/guides/corriger/ou-corriger-quoi/).
