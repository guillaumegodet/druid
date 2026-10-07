---
title: "Instances and features"
description: "Why some features do not exist on every Druid instance, and who has access to what."
sidebar:
  order: 8
---

## What it is

Druid is used by several institutions. Each has its own **instance**: its data, its
accounts, and the **features** its environment allows. A university connected to its LDAP
directory and to CRISalid has more features than a school that uses Druid on its own.

This help is **shared by all instances**. When a feature is optional, the page says so in an
“Available on: instances connected to…” box. If you cannot find a button described in the
help, your instance probably does not have the feature, or your profile does not allow it.

## Optional features

| Feature | What it brings | What is missing without it |
|---|---|---|
| **The institution's LDAP directory** | Statuses calculated from the state of accounts, synchronisation of grades and employment dates, **LDAP alignment** page, import of structures. | Statuses and employment data entered by hand; no LDAP tab. |
| **Statuses and manual validation** | Presence (Present/Leaving/Left), Internal staff shortcut, validation badges, import of validated lists. | No Presence column and no validation. |
| **Rerunning identifier searches** | **Find missing**, **Search everywhere**, **Check existing ones** buttons on the alignment page. | Candidates are calculated by the technical team; the page still lets you validate them. |
| **Enhanced IdRef alignment** | Choice between IdRef namesakes refined with the CRISalid graph. | Simple IdRef search, by name and dates. |
| **ETL console** | Regenerating the dashboards from Druid, configuring structures, checking affiliations. | Dashboards regenerated outside Druid. |
| **Access rights** | View of the rights groups and their members in **Administration** (rights are granted in the Keycloak console). | Access managed by the technical team. |
| **Report saving** | **My reports** saved on the instance: sharing, history, instance templates. | On a read-only demo, reports are kept in the browser only. |
| **Report PDF archiving** | Generated PDFs are kept in the report history and can be shared frozen. | The history keeps the date, author and scope, without the file. |
| **AI texts (ILAAS)** | Summary and analysis by theme of reports; thematic analysis of collaborations. | **AI text** blocks cannot be generated. |
| **Chat assistant** | Floating button to query the CRISalid data in natural language. | — |
| **Export to CRISalid** | Sending researchers, identifiers and structures to CRISalid (**Synchronise with SoVisu+** button). | No automatic harvesting of publications per person. |

## Profiles and rights

Your **profile** determines the sections you see and the scope of the data.

| Profile | Scope | What it also allows |
|---|---|---|
| **Laboratory member** | The laboratory or laboratories of **your own record** in the directory | View People and the Dashboard, correct the records of your lab. |
| **Lab management** | The laboratories granted | Same, without depending on your own record. |
| **Central services** | The whole institution | Structures, Alignment tools. |
| **Druid administrator** | The whole institution | Groups, To process (duplicates and tasks), Report a correction, viewing rights. |
| **Technical administrator** | Depending on their other profile | ETL console, hidden tabs of the dashboard; with access to the whole institution: Synchronise menu, creating records. |
| **Communication officer** | — | Media sources of the news watch. |

Profiles **add up**. An account logged in without any specific right is treated as a
**laboratory member**: its scope is derived from its record. Without a record, it sees no
data.

Depending on the instance, rights are managed by the institution's directory (groups of the
authentication service) or by a list of authorised addresses. On the latter type of
instance, every authorised account sees the whole institution, and the lab and
communication profiles do not exist.

## Example

On an instance **connected** to the LDAP directory and to CRISalid, a laboratory director
sees each member's status calculated from the directory, can validate her lab's records, and
the identifiers she has completed go to CRISalid.

On a **standalone** instance, the same person views the directory and the dashboards, but
statuses are not shown and the export to CRISalid is not offered.

## Known limitations

- **A missing feature is not announced**: Druid simply hides the button. If in doubt, ask
  your instance's administrator.
- **The lab scope depends on your record**: if your record mentions a former laboratory, you
  will see that laboratory.
- **Some combinations are restrictive**: the **To process** button only appears for Druid
  administrators who are also technical administrators.

## How to report an error

Missing an access or a feature? See
[First steps for your profile](/en/demarrer/premiers-pas/#requesting-additional-access)
and [Support](/en/guides/support/).
