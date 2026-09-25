---
title: "Indicators"
description: "Definition and calculation of the dashboard indicators: FWCI, top 1% and 10%, quartiles, open access, APCs."
sidebar:
  order: 7
---

## What it is

This page defines the dashboard indicators and says **on which publications** they are
calculated. All of them apply to the **period** and the **scope** chosen at the top of the
dashboard (see
[Publications and attribution](/en/donnees/publications-attribution/#the-two-scopes-of-the-dashboard)).

## Counting

Druid uses **full counting**: a publication counts as **1** for the structure, whatever the
number of its authors or laboratories. There is no fractional counting.

- A publication co-signed by two teams counts **1 for each team**, and **1** for the
  structure (not 2).
- A publication co-signed by two laboratories of the institution counts **1 for each of
  them**: the sum of the laboratories therefore exceeds the institution's total.

## Volume and profile

| Indicator | Definition |
|---|---|
| **Publications** | Number of publications in the period, all types together. |
| **Publication types** | Articles, chapters, books, conference papers… according to the typology of the sources. |
| **Citations** | Sum of the citations received, according to OpenAlex, on the date the dashboard was generated. |
| **International collaboration** | Share of publications with at least one co-author from a foreign institution. |
| **Language** | Language of the publication, according to OpenAlex. |

### Output ratios

If the structure's research headcount in **FTE** (research full-time equivalent) has been
entered, the Overview shows two ratios per FTE and per year:

- **RICL**: articles in journals indexed by SCImago, used as a proxy for “international
  peer-reviewed journals” (*revues internationales à comité de lecture*);
- **Conferences**: all conference papers. The sources do not distinguish national from
  international conferences.

## Impact

### FWCI

The **FWCI** (*Field-Weighted Citation Impact*) relates the citations of a publication to
the world average of publications **of the same field, type and year**. It is provided by
OpenAlex.

- **1** = exactly the world average;
- **2** = cited twice as much as the average;
- **0.5** = half as much.

The dashboard shows the **mean FWCI** of the publications that have one, and the **share of
publications** for which it is known.

### Top 1% and top 10%

A publication is in the **top 10%** (or **top 1%**) if it is among the 10% (or 1%) most
cited of comparable publications (field, year). The information comes from OpenAlex. The
percentages are calculated on the publications whose impact is known.

Benchmark: in an “average” structure, 10% of publications are in the top 10% and 1% in the
top 1%.

### Journal quartiles

The **SJR quartile** ranks a journal in its discipline according to the **SCImago** ranking:
**Q1** for the best-ranked quarter, **Q4** for the lowest-ranked. Druid keeps the journal's
best quartile across all disciplines, and attaches it to the article through its ISSN.

## Open access

The open-access status comes from the **French Open Science Monitor** (*Baromètre de la
science ouverte*, based on Unpaywall) when the publication is in it, otherwise from
**OpenAlex**.

| Status | Meaning |
|---|---|
| **Diamond** | Open-access journal with no publication fees. |
| **Gold** | Fully open-access journal, usually with APCs. |
| **Hybrid** | Open-access article in a subscription journal, usually against an APC. |
| **Bronze** | Free to read on the publisher's website, without an open licence. |
| **Green** | Only accessible thanks to a deposit in an open archive (HAL, etc.). |
| **Closed** | No accessible version found. |
| **Unknown** | Status not determined (often no DOI). |

## APCs

**APCs** (*Article Processing Charges*) are the fees paid to a publisher to publish in open
access. The **APC monitoring** tab presents them from three angles:

| Sub-tab | Source | What it measures |
|---|---|---|
| **Estimate (OpenAlex)** | OpenAlex | List price of the journal, or the amount paid when known. An **estimate**: OpenAlex does not say who paid. |
| **Publisher agreements** | Publisher reports (transformative agreements) | Articles published under a negotiated agreement, triggered by the corresponding author. |
| **Actual spending (OpenAPC)** | OpenAPC | Amounts actually reported by institutions, if any. |

Amounts in foreign currencies are converted into euros at an approximate rate.

## Known limitations

- **Dependence on OpenAlex**: FWCI, top 1%/10%, citations and estimated APCs come from
  OpenAlex. Their coverage is good for articles with a DOI, poor for books and for
  publications in the humanities and social sciences.
- **Recent publications**: the FWCI and the tops are unstable for publications less than two
  or three years old, which have had little time to be cited.
- **Small numbers**: over a few dozen publications, a single highly cited publication makes
  the mean FWCI vary a lot. Interpret with care for a team.
- **Quartiles**: a single SCImago ranking is used for all years; a journal that changed
  quartile is ranked according to that ranking. Journals missing from SCImago have no
  quartile.
- **Open-access status**: it changes over time (late deposits in HAL) and is only updated
  when the dashboard is regenerated.
- **APCs**: the OpenAlex estimate overstates actual spending (list prices, discounts and
  agreements not taken into account) and does not say who paid.
- **Full counting**: it favours structures that co-sign a lot. It does not allow you to add
  up the results of several structures.

## How to report an error

Does an indicator look wrong? First check the chosen scope and period, then the list of the
publications concerned (**Publication list** tab). Then see
[A publication is missing or wrongly attributed](/en/guides/corriger/publication-manquante/)
or [Support](/en/guides/support/).
