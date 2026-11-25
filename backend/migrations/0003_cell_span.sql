-- Сколько дней занимает ячейка, начиная с её собственной даты. 1 — обычная клетка.
ALTER TABLE cells ADD COLUMN span INTEGER NOT NULL DEFAULT 1 CHECK (span BETWEEN 1 AND 62);

-- Старый импорт хранил объединение как заливку на пустых следующих днях.
-- Собираем такие цепочки в span и убираем клетки-продолжения.
DO $$
DECLARE
  rec RECORD;
  n INTEGER;
BEGIN
  FOR rec IN
    SELECT row_id, day, bg
    FROM cells
    WHERE value <> '' AND bg IS NOT NULL
    ORDER BY row_id, day
  LOOP
    n := 1;
    WHILE n < 62 AND EXISTS (
      SELECT 1 FROM cells c
      WHERE c.row_id = rec.row_id
        AND c.day = rec.day + n
        AND c.value = ''
        AND c.comment = ''
        AND c.bg = rec.bg
    ) LOOP
      n := n + 1;
    END LOOP;
    IF n > 1 THEN
      UPDATE cells SET span = n WHERE row_id = rec.row_id AND day = rec.day;
      DELETE FROM cells
      WHERE row_id = rec.row_id
        AND day > rec.day
        AND day < rec.day + n;
    END IF;
  END LOOP;
END $$;
