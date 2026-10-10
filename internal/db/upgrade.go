package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// upgradeCopies is the folder of the data directory that holds the Upgrade
// copies: each a copy of the database as it was before a newer Bandmate
// migrated it, to roll back to.
const upgradeCopies = "upgrade-copies"

// upgradeCopiesKept is how many Upgrade copies are kept, the newest.
const upgradeCopiesKept = 3

// UpgradeCopyError means the Upgrade copy couldn't be taken, so nothing
// was migrated.
type UpgradeCopyError struct {
	// Err is why it couldn't.
	Err error
}

func (e *UpgradeCopyError) Error() string { return "taking the upgrade copy: " + e.Err.Error() }

func (e *UpgradeCopyError) Unwrap() error { return e.Err }

// OpenToRun opens the database in dataDir for the Bandmate running to run
// on, as it starts. It's OpenNoNewer, taking an Upgrade copy before
// migrating a database that already has migrations applied, and recording
// running as the Bandmate that last ran on the database. If the copy can't
// be taken it migrates nothing and fails with an *UpgradeCopyError. The
// copy is named after the release the database last ran on, or, if none is
// recorded, after now.
func OpenToRun(ctx context.Context, dataDir, running string, now time.Time) (*sql.DB, error) {
	conn, err := open(dataDir)
	if err != nil {
		return nil, err
	}
	if err := openToRun(ctx, conn, dataDir, running, now); err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

func openToRun(ctx context.Context, conn *sql.DB, dataDir, running string, now time.Time) error {
	if err := refuseNewer(ctx, conn); err != nil {
		return err
	}
	upgrading, err := upgrading(ctx, conn)
	if err != nil {
		return err
	}
	if upgrading {
		if err := takeUpgradeCopy(ctx, conn, filepath.Join(dataDir, upgradeCopies), now); err != nil {
			return &UpgradeCopyError{Err: err}
		}
	}
	if err := migrate(ctx, conn); err != nil {
		return err
	}
	return recordVersion(ctx, conn, running)
}

// upgrading tells whether the database has migrations applied and others
// pending: whether starting changes how an existing install's data is
// stored.
func upgrading(ctx context.Context, conn *sql.DB) (bool, error) {
	if ok, err := hasTable(ctx, conn, "schema_migrations"); err != nil || !ok {
		return false, err
	}
	var applied int
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations`).Scan(&applied); err != nil {
		return false, fmt.Errorf("reading the schema: %w", err)
	}
	known, err := knownMigrations()
	if err != nil {
		return false, err
	}
	// refuseNewer has checked every applied migration is a known one.
	return applied > 0 && applied < len(known), nil
}

// hasTable tells whether the database has the table name.
func hasTable(ctx context.Context, conn *sql.DB, name string) (bool, error) {
	var tables int
	if err := conn.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&tables); err != nil {
		return false, fmt.Errorf("reading the schema: %w", err)
	}
	return tables > 0, nil
}

// recordVersion records version as the Bandmate that last ran on the
// database, which names the next Upgrade copy.
func recordVersion(ctx context.Context, conn *sql.DB, version string) error {
	if _, err := conn.ExecContext(ctx, `INSERT INTO bandmate_version (id, version) VALUES (1, ?)
		ON CONFLICT (id) DO UPDATE SET version = excluded.version`, version); err != nil {
		return fmt.Errorf("recording the version: %w", err)
	}
	return nil
}

// recordedVersion is the Bandmate that last ran on the database, or empty
// if none is recorded, as a Bandmate from before 0041_bandmate_version
// records none.
func recordedVersion(ctx context.Context, conn *sql.DB) (string, error) {
	if ok, err := hasTable(ctx, conn, "bandmate_version"); err != nil || !ok {
		return "", err
	}
	var version string
	err := conn.QueryRowContext(ctx, `SELECT version FROM bandmate_version WHERE id = 1`).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("reading the recorded version: %w", err)
	}
	return version, nil
}

// release matches a release's version, e.g. v0.14.2, capturing it without
// its v. A dev build or a bare commit isn't a version one could pull.
var release = regexp.MustCompile(`^v(\d+\.\d+\.\d+)$`)

// takeUpgradeCopy copies the database, as it is, into dir, then deletes all
// but the newest upgradeCopiesKept copies there.
func takeUpgradeCopy(ctx context.Context, conn *sql.DB, dir string, now time.Time) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	from, err := recordedVersion(ctx, conn)
	if err != nil {
		return err
	}
	path, err := upgradeCopyPath(dir, from, now)
	if err != nil {
		return err
	}
	// VACUUM INTO reads through the connection, the WAL included, so the
	// copy is consistent. It's renamed into place once whole.
	partial := filepath.Join(dir, "."+filepath.Base(path)+".partial")
	if err := os.Remove(partial); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if _, err := conn.ExecContext(ctx, `VACUUM INTO ?`, partial); err != nil {
		os.Remove(partial)
		return err
	}
	if err := os.Rename(partial, path); err != nil {
		os.Remove(partial)
		return err
	}
	// Only tidying, so it never stops Bandmate starting.
	if err := pruneUpgradeCopies(dir); err != nil {
		log.Printf("deleting older upgrade copies: %v", err)
	}
	return nil
}

// upgradeCopyPath is where in dir the Upgrade copy of a database the
// Bandmate from last ran on goes: named after that release, or after now's
// date if from isn't one. Should the name be taken, now's time is added
// (and the date, to a release's name), then a number, so no earlier copy is
// replaced.
func upgradeCopyPath(dir, from string, now time.Time) (string, error) {
	name, timed := "before-"+now.Format("2006-01-02"), now.Format("-150405")
	if m := release.FindStringSubmatch(from); m != nil {
		name, timed = "before-"+m[1], now.Format("-2006-01-02-150405")
	}
	candidates := []string{name, name + timed}
	for n := 2; n < 100; n++ {
		candidates = append(candidates, fmt.Sprintf("%s%s-%d", name, timed, n))
	}
	for _, c := range candidates {
		path := filepath.Join(dir, c+".db")
		_, err := os.Stat(path)
		if errors.Is(err, fs.ErrNotExist) {
			return path, nil
		}
		if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("every name for the copy is taken, up to %s", candidates[len(candidates)-1])
}

// pruneUpgradeCopies deletes all but the newest upgradeCopiesKept Upgrade
// copies in dir, newest by when they were taken.
func pruneUpgradeCopies(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	type taken struct {
		name string
		at   time.Time
	}
	var copies []taken
	for _, e := range entries {
		if e.IsDir() || !strings.HasPrefix(e.Name(), "before-") || filepath.Ext(e.Name()) != ".db" {
			continue
		}
		info, err := e.Info()
		if err != nil {
			return err
		}
		copies = append(copies, taken{e.Name(), info.ModTime()})
	}
	sort.Slice(copies, func(i, j int) bool {
		if !copies[i].at.Equal(copies[j].at) {
			return copies[i].at.After(copies[j].at)
		}
		return copies[i].name > copies[j].name
	})
	for _, c := range copies[min(len(copies), upgradeCopiesKept):] {
		if err := os.Remove(filepath.Join(dir, c.name)); err != nil {
			return err
		}
	}
	return nil
}
