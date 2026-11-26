-- Розовый уголок: поставщику на этот день уже отправили данные.
ALTER TABLE cells ADD COLUMN sent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cell_changes ADD COLUMN sent BOOLEAN NOT NULL DEFAULT FALSE;
