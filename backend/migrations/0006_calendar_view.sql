-- Общий период графика: одинаковый для всех после обновления страницы.
CREATE TABLE calendar_view (
    id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    from_day   DATE NOT NULL,
    to_day     DATE NOT NULL,
    focus_day  DATE NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (from_day <= to_day),
    CHECK (focus_day BETWEEN from_day AND to_day)
);
