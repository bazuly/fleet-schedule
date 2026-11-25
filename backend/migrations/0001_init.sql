CREATE TABLE users (
    id            UUID PRIMARY KEY,
    login         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- Строка графика. panel: main — основной график транспорта,
-- unassigned — «Нераспределенное», pickups — «Заборы продукции».
CREATE TABLE schedule_rows (
    id         UUID PRIMARY KEY,
    panel      TEXT NOT NULL CHECK (panel IN ('main', 'unassigned', 'pickups')),
    position   DOUBLE PRECISION NOT NULL,
    driver     TEXT NOT NULL DEFAULT '',
    tractor    TEXT NOT NULL DEFAULT '',
    trailer    TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX schedule_rows_panel_pos_idx ON schedule_rows(panel, position);

CREATE TABLE cells (
    row_id     UUID NOT NULL REFERENCES schedule_rows(id) ON DELETE CASCADE,
    day        DATE NOT NULL,
    value      TEXT NOT NULL DEFAULT '',
    bg         TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (row_id, day)
);
CREATE INDEX cells_day_idx ON cells(day);

INSERT INTO schedule_rows (id, panel, position)
SELECT gen_random_uuid(), p.panel, g.n
FROM (VALUES ('unassigned'), ('pickups')) AS p(panel)
CROSS JOIN generate_series(1, 15) AS g(n);
