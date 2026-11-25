-- История правок дневных клеток: кто изменил и во что клетка превратилась.
CREATE TABLE cell_changes (
    id         BIGSERIAL PRIMARY KEY,
    row_id     UUID NOT NULL REFERENCES schedule_rows(id) ON DELETE CASCADE,
    day        DATE NOT NULL,
    user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    user_name  TEXT NOT NULL DEFAULT '',
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    value      TEXT NOT NULL DEFAULT '',
    comment    TEXT NOT NULL DEFAULT '',
    bg         TEXT,
    fg         TEXT,
    span       INTEGER NOT NULL DEFAULT 1,
    deleted    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX cell_changes_lookup_idx ON cell_changes (row_id, day, changed_at DESC);
