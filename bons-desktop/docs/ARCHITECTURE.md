# ARACO Bons — structure and database

A Windows desktop app (Python 3.11+, PySide6, SQLite) for ARACO Ready Mix customers and
delivery tickets ("bons"). It runs fully offline. All data lives in `C:\ARACO_Data\`.

## Folder layout

```
bons-desktop/
├── main.py                  entry point (login → main window)
├── araco/
│   ├── config.py            data paths (C:\ARACO_Data, override with ARACO_DATA_DIR)
│   ├── db.py                SQLite connection, schema, migrations, text normalisation
│   ├── i18n.py              Arabic / English strings, RTL switch
│   ├── auth.py              PBKDF2 password hashing
│   ├── context.py           Ctx (db + logged-in user), ValidationError, permission checks
│   ├── backup.py            daily automatic backup (keep 30), manual backup, ZIP, restore
│   ├── importer.py          Excel/CSV reader, column guessing, customer import
│   ├── exporter.py          Excel (openpyxl) and PDF (reportlab, Arabic shaping) export
│   ├── media.py             image/PDF loading (pypdfium2) for the viewer and OCR
│   ├── scanner.py           WIA scanner acquisition (pywin32), feeder/batch support
│   ├── ocr.py               Tesseract (eng+ara) + field extraction (ticket no, date, m³)
│   ├── seed.py              ~20 sample customers, ~150 tickets, sample scan images
│   ├── services/            business logic, no Qt: customers, tickets, reports,
│   │                        lookups, users, audit, settings
│   └── ui/                  PySide6 screens: login, main window + sidebar, dashboard,
│                            customers, customer page, tickets, ticket quick-entry form,
│                            batch scan, image viewer, reports, trash, audit, settings
├── tests/                   pytest: services, import/export, OCR parsing, backup, GUI smoke
├── araco_bons.spec          PyInstaller spec (single .exe)
├── build.bat                build the .exe on Windows
└── README.md                Arabic user guide
```

Business logic lives in `araco/services` and never imports Qt. The tests use it directly,
and the UI is a thin layer on top.

## Database schema (SQLite, `database.db`)

```sql
users        (id PK, username UNIQUE, full_name, password_hash,
              role CHECK IN ('admin','data_entry'), active, created_at)

customers    (id PK, code UNIQUE,                -- auto C0001, C0002 … (or imported code)
              name NOT NULL, company, phone, phone2, address, area,
              payment_terms, notes,
              created_at, created_by → users, updated_at, updated_by → users,
              deleted_at, deleted_by → users)     -- soft delete (Trash)

sites        (id PK, customer_id → customers, name NOT NULL, address, notes,
              created_at, created_by, deleted_at,
              UNIQUE (customer_id, name))         -- one customer → many project sites

tickets      (id PK, ticket_no NOT NULL,          -- unique among non-deleted tickets
              date 'YYYY-MM-DD' NOT NULL, time 'HH:MM',
              customer_id → customers NOT NULL, site_id → sites,
              grade NOT NULL,                     -- B200, B250 … (from lookups)
              quantity REAL CHECK (quantity > 0), -- m³
              truck_no, driver, pump_used 0/1, pump_no, plant,
              unit_price REAL ≥ 0, total REAL,    -- total = quantity × unit_price
              status CHECK IN ('delivered','cancelled'), notes,
              created_at, created_by, updated_at, updated_by, deleted_at, deleted_by)
UNIQUE INDEX ux_tickets_no ON tickets(ticket_no) WHERE deleted_at IS NULL

ticket_scans (id PK, ticket_id → tickets, file_path,   -- relative: scans/YYYY/MM/<file>
              original_name, ocr_text, created_at, created_by)

lookups      (id PK, kind IN ('grade','plant','truck','driver'), value, sort_order, active,
              UNIQUE (kind, value))              -- editable lists in Settings;
                                                 -- trucks/drivers also learnt on save

settings     (key PK, value)                     -- language, OCR on/off, tesseract path,
                                                 -- scanner DPI, currency, company name …

audit_log    (id PK, ts, user_id, username, action,     -- create/update/delete/restore/
              entity, entity_id, details JSON)           -- purge/login/import/backup/restore
```

Notes:
- Tickets keep grade, plant, truck and driver as text. Renaming a list entry later does not
  change history.
- Reports count only `delivered`, non-deleted tickets. Cancelled tickets stay visible in
  searches.
- Every record has `created_by/at` and `updated_by/at`. Each change also writes an
  `audit_log` row holding the changed fields (old → new).
- A custom SQLite function `norm()` makes Arabic search ignore hamza and alef forms
  (أ/إ/آ → ا, ة → ه, ى → ي), diacritics and Arabic-Indic digits.

## Roles

| Action                                   | admin | data_entry |
|------------------------------------------|:-----:|:----------:|
| Add / edit customers and tickets, scan   |  ✔    |   ✔        |
| Search, reports, export                  |  ✔    |   ✔        |
| Delete, Trash (restore / purge)          |  ✔    |            |
| Import customers and past tickets        |  ✔    |            |
| Settings, users, lists, backup/restore   |  ✔    |            |
| Audit log                                |  ✔    |            |
