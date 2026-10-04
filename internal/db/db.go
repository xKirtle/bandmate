// Package db opens Bandmate's SQLite database and keeps its schema up to date.
package db

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite" // pure-Go SQLite driver, registered as "sqlite"
)

// FileName is the database file's name inside the data directory.
const FileName = "bandmate.db"

//go:embed migrations/*.sql
var migrations embed.FS

// Open opens (creating if needed) the database in dataDir and applies any
// pending migrations.
func Open(ctx context.Context, dataDir string) (*sql.DB, error) {
	return OpenBefore(ctx, dataDir, "")
}

// OpenBefore is Open, stopping short of the migration named stop and those
// after it, or applying them all if stop is "". It lets a test make a
// database at an older schema, e.g. a Backup made by an older Bandmate.
func OpenBefore(ctx context.Context, dataDir, stop string) (*sql.DB, error) {
	conn, err := open(dataDir)
	if err != nil {
		return nil, err
	}
	if err := migrateBefore(ctx, conn, stop); err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

// ErrNewer means a database records a migration this Bandmate doesn't
// know, so a newer Bandmate migrated it.
var ErrNewer = errors.New("the database was migrated by a newer Bandmate")

// OpenNoNewer is Open, refusing with ErrNewer a database a newer Bandmate
// migrated, e.g. a Backup it made, rather than migrating it alongside
// changes this Bandmate doesn't know.
func OpenNoNewer(ctx context.Context, dataDir string) (*sql.DB, error) {
	conn, err := open(dataDir)
	if err != nil {
		return nil, err
	}
	err = refuseNewer(ctx, conn)
	if err == nil {
		err = migrate(ctx, conn)
	}
	if err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

// open opens (creating if needed) the database in dataDir as it is.
func open(dataDir string) (*sql.DB, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating data directory: %w", err)
	}
	dsn := "file:" + filepath.Join(dataDir, FileName) +
		"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}
	// SQLite allows one writer at a time; a single connection avoids
	// "database is locked" errors for a single-user app.
	conn.SetMaxOpenConns(1)
	return conn, nil
}

// refuseNewer returns ErrNewer if the database records a migration this
// Bandmate doesn't know.
func refuseNewer(ctx context.Context, conn *sql.DB) error {
	var tables int
	if err := conn.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`).Scan(&tables); err != nil {
		return fmt.Errorf("reading the schema: %w", err)
	}
	if tables == 0 {
		return nil
	}
	known, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	names := make([]string, len(known))
	for i, path := range known {
		names[i] = strings.TrimSuffix(filepath.Base(path), ".sql")
	}
	list, err := json.Marshal(names)
	if err != nil {
		return err
	}
	var unknown int
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations
		WHERE name NOT IN (SELECT value FROM json_each(?))`, string(list)).Scan(&unknown); err != nil {
		return fmt.Errorf("reading the schema: %w", err)
	}
	if unknown > 0 {
		return ErrNewer
	}
	return nil
}

// migrate applies every embedded migration not yet recorded in
// schema_migrations, in file name order, each in its own transaction.
func migrate(ctx context.Context, conn *sql.DB) error {
	return migrateBefore(ctx, conn, "")
}

// migrateBefore is migrate, stopping short of the migration named stop and
// those after it, or applying them all if stop is "". It lets a test put
// data in an older schema and see a migration carry it over.
func migrateBefore(ctx context.Context, conn *sql.DB, stop string) error {
	if _, err := conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		name TEXT PRIMARY KEY,
		applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	)`); err != nil {
		return fmt.Errorf("creating schema_migrations: %w", err)
	}

	// Glob returns names in lexical order, which is the order to apply them.
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}

	for _, path := range names {
		name := strings.TrimSuffix(filepath.Base(path), ".sql")
		if stop != "" && name >= stop {
			break
		}
		var applied int
		if err := conn.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM schema_migrations WHERE name = ?`, name).Scan(&applied); err != nil {
			return fmt.Errorf("checking migration %s: %w", name, err)
		}
		if applied > 0 {
			continue
		}
		script, err := migrations.ReadFile(path)
		if err != nil {
			return err
		}
		if err := apply(ctx, conn, name, string(script)); err != nil {
			return fmt.Errorf("applying migration %s: %w", name, err)
		}
	}
	return nil
}

// Description is what a bug report needs to know about the database.
type Description struct {
	// SQLiteVersion is the SQLite engine's version, e.g. 3.50.4.
	SQLiteVersion string `json:"sqliteVersion"`
	// Schema is the latest migration applied, which names the schema.
	Schema Schema `json:"schema"`
}

// Schema is the migration that brought the database to its schema.
type Schema struct {
	// Migration is its name, e.g. 0027_track_volume_range.
	Migration string `json:"migration"`
	// AppliedAt is when it was applied, in UTC.
	AppliedAt time.Time `json:"appliedAt"`
}

// Describe tells which SQLite the database runs on and which schema it has.
func Describe(ctx context.Context, conn *sql.DB) (Description, error) {
	var d Description
	if err := conn.QueryRowContext(ctx, `SELECT sqlite_version()`).Scan(&d.SQLiteVersion); err != nil {
		return d, fmt.Errorf("reading the SQLite version: %w", err)
	}
	// Migrations are applied in name order, so the greatest name is the latest.
	var appliedAt string
	if err := conn.QueryRowContext(ctx,
		`SELECT name, applied_at FROM schema_migrations ORDER BY name DESC LIMIT 1`).Scan(&d.Schema.Migration, &appliedAt); err != nil {
		return d, fmt.Errorf("reading the schema: %w", err)
	}
	t, err := time.Parse(appliedAtLayout, appliedAt)
	if err != nil {
		return d, fmt.Errorf("reading when %s was applied: %w", d.Schema.Migration, err)
	}
	d.Schema.AppliedAt = t
	return d, nil
}

// appliedAtLayout is how schema_migrations records when a migration was
// applied: strftime('%Y-%m-%dT%H:%M:%fZ').
const appliedAtLayout = "2006-01-02T15:04:05.000Z"

func apply(ctx context.Context, conn *sql.DB, name, script string) error {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, script); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (name) VALUES (?)`, name); err != nil {
		return err
	}
	return tx.Commit()
}
