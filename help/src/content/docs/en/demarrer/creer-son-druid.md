---
title: "Create the Druid of your institution"
description: "The « Create my Druid » portal: institution, laboratories, address, then automatic build."
sidebar:
  order: 4
---

On the hosted offer of Druid, any institution can create its instance in a few minutes, with
nothing to install. You enter your institution and your laboratories; Druid finds their
identifiers and builds your space.

## Before you start

- A **work e-mail address**: it becomes the administrator account of the Druid.
- The **name of your institution** as it appears in the ROR registry (nearly every university
  and school is there).
- For a French institution, nothing else: the UAI, the SIRET, the IdRef and the list of
  laboratories (RNSR) are fetched automatically.

## The three steps

1. **Institution** — type the name, pick the right record in the ROR list. Druid shows the
   identifiers it found (UAI, SIRET, IdRef, Wikidata, OpenAlex) and the website.
2. **Laboratories** — the research structures that list your institution among their
   supervising bodies in the RNSR are prelisted and checked: uncheck the ones that are not
   yours (units where you are only a secondary supervisor, for instance), add the missing ones
   (one per line: `acronym ; name ; optional RNSR number`).
3. **Confirmation** — the display name, the address of your Druid (`your-institution.…`) and
   the e-mail domain of the institution. Confirm.

The build takes less than a minute: database, structures, address. You receive an e-mail when
it is done, and the **Open my Druid** button signs you in directly.

## Next

- **Load your researchers**: [make the directory of a laboratory reliable](/en/tutoriels/fiabiliser-annuaire-labo/), then
  run the alignment of identifiers (IdRef, ORCID, IdHAL, OpenAlex).
- **Complete the identifiers of the structures** (ROR, HAL, OpenAlex): the Structures tab of
  the Alignment page proposes them.
- **Invite colleagues**: the free trial includes one account; the Team and Complete plans add
  more (« My institution » page).

## If your institution already has a Druid

Only one trial per institution. If somebody already created it, the portal says so and offers
to **request access**: the administrator of that Druid is told.
