-- migrate:up
-- A birth date may be known to the year or the month only (lib/dates.ts): `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, like the
-- employment dates. The full dates already stored keep their value (YYYY-MM-DD text).
ALTER TABLE person ALTER COLUMN birth_date TYPE fuzzy_date USING to_char(birth_date, 'YYYY-MM-DD');

-- migrate:down
-- A reduced-precision date goes back to its first day (1980 → 1980-01-01, 1980-06 → 1980-06-01).
ALTER TABLE person ALTER COLUMN birth_date TYPE date USING fuzzy_date_lower(birth_date);
