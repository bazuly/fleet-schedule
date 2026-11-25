-- Ручной статус машины: заливка водителя, тягача и прицепа.
ALTER TABLE schedule_rows
    ADD COLUMN status TEXT NOT NULL DEFAULT ''
        CHECK (status IN ('', 'work', 'dayoff', 'sick', 'free', 'repair'));
