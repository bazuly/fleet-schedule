-- Автособранные объединения возвращаем в отдельные дни.
-- Заливка и цвет текста копируются на каждый день, текст остаётся в первой клетке.
DO $$
DECLARE
  rec RECORD;
  i INTEGER;
BEGIN
  FOR rec IN
    SELECT row_id, day, bg, fg, span FROM cells WHERE span > 1
  LOOP
    FOR i IN 1 .. rec.span - 1 LOOP
      IF rec.bg IS NOT NULL OR rec.fg IS NOT NULL THEN
        INSERT INTO cells (row_id, day, value, bg, fg, comment, span, updated_at)
        VALUES (rec.row_id, rec.day + i, '', rec.bg, rec.fg, '', 1, now())
        ON CONFLICT (row_id, day) DO UPDATE SET
          bg = COALESCE(cells.bg, EXCLUDED.bg),
          fg = COALESCE(cells.fg, EXCLUDED.fg);
      END IF;
    END LOOP;
    UPDATE cells SET span = 1 WHERE row_id = rec.row_id AND day = rec.day AND span > 1;
  END LOOP;
END $$;
