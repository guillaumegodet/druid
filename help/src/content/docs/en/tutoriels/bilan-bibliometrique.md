---
title: "Prepare the bibliometric part of an evaluation report"
description: "Complete walkthrough for an HCÉRES evaluation or an activity report: scope, indicators, exports."
sidebar:
  order: 2
---

:::note[In short]
- **Goal:** produce a unit's figures, charts and list of publications for an evaluation
  report (HCÉRES, the French evaluation agency) or an activity report, while being able to
  explain where they come from.
- **For:** laboratory management or administration, central services.
- **Time:** half a day, plus the time of a possible dashboard regeneration.
- **You need:** the period of the report (for example the last five years) and, for the
  ratios, the research headcount in FTE.
:::

## Step 1 — Prepare the data (two to three weeks before)

The figures are only as good as the directory and the affiliations:

1. **Directory**: are the unit's members up to date and validated? If not, see
   [Make a laboratory's directory reliable](/en/tutoriels/fiabiliser-annuaire-labo/).
2. **HAL**: are the publications of the period deposited in the unit's collection, with the
   right affiliation? It is often the only source for books and chapters.
3. **Regeneration**: ask the technical team to regenerate the unit's dashboard once these
   corrections are made, and, if you want the output ratios, to enter the **research FTE**
   (see [Run the ETL console](/en/guides/administration/console-etl/)).

## Step 2 — Set up the dashboard

1. Open the unit's **Dashboard**.
2. Set the **period** of the report.
3. Choose the **scope**:

| Question of the report | Scope |
|---|---|
| “What did the unit publish during the period?” (the usual case for an HCÉRES report) | **Affiliation**: all publications signed by the unit, including those of members who have since left. |
| “What do the current members publish under the unit's affiliation?” | **Headcount**: only the publications of at least one current member. |

4. **Copy link**: keep the address of this view in your notes, to find exactly the same
   settings again.

## Step 3 — Note the key figures

| Tab | What to note | Worth knowing |
|---|---|---|
| **Overview** | Number of publications per year and per type, open-access share, international collaboration, ratios per FTE | Full counting: a co-publication of two units counts for each. |
| **Impact and citations** | Mean FWCI, share in the top 10% and the top 1% | Unstable for recent publications and small numbers. |
| **Journals** | Main journals, breakdown by SJR quartile | A single SCImago ranking for all years. |
| **Books** | Books and chapters | Incomplete coverage outside HAL. |
| **Collaborations** | National and international partners | See [Analyse collaborations](/en/guides/tableau-de-bord/collaborations/). |
| **Signature charter** | Affiliation compliance rate | Useful for an action plan on affiliations. |

The definition of each indicator and its limitations are in
[Indicators](/en/donnees/indicateurs/): reuse them in the “methodology” part of your report.
Each chart's **Methodology** button also gives its description and limitations.

## Step 4 — Check the list of publications

1. Open **Publication list** and **Export as CSV (filtered results)**.
2. Have the list reviewed by the unit: missing publications, publications that are not the
   unit's.
3. For each discrepancy, see [A publication is missing or wrongly attributed](/en/guides/corriger/publication-manquante/).

:::caution
If major corrections are made (HAL deposits, OpenAlex affiliations), the dashboard must be
**regenerated** before noting the final figures.
:::

## Step 5 — Produce the deliverables

- **PDF report**: build a report with the useful charts, on the chosen period and scope (see
  [Export data and reports](/en/guides/tableau-de-bord/exporter/)).
- **Individual charts**: **Download as PNG** from each chart's toolbar, to insert them into
  the report.
- **List of publications**: the reviewed CSV from step 4.

## Step 6 — Document

In the report, state:

- the extraction **date** and the **period**;
- the **scope** (Affiliation or Headcount);
- the **sources** (OpenAlex, French Open Science Monitor, HAL, CRISalid) and **full
  counting**;
- the known limitations of the indicators used.

## Summary

- [ ] The unit's directory made reliable, HAL deposits checked
- [ ] Dashboard regenerated (and FTE entered for the ratios)
- [ ] Period and scope chosen, link to the view kept
- [ ] Key figures noted with their limitations
- [ ] List of publications reviewed by the unit
- [ ] PDF report and charts exported
- [ ] Methodology documented

## See also

- [Publications and attribution](/en/donnees/publications-attribution/)
- [Choose a structure, a period, a scope](/en/guides/tableau-de-bord/structure-periode-perimetre/)
