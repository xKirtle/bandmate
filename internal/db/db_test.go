package db

import (
	"context"
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"
)

// openBefore opens a fresh database migrated up to, but not including, the
// migration named stop.
func openBefore(t *testing.T, stop string) *sql.DB {
	t.Helper()
	conn, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), FileName)+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatalf("opening database: %v", err)
	}
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { conn.Close() })
	if err := migrateBefore(context.Background(), conn, stop); err != nil {
		t.Fatalf("migrating: %v", err)
	}
	return conn
}

// exec runs statements, failing the test if any fails.
func exec(t *testing.T, conn *sql.DB, stmts ...string) {
	t.Helper()
	for _, stmt := range stmts {
		if _, err := conn.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
}

func TestOccurrenceCuesMoveToTheirFirstLines(t *testing.T) {
	conn := openBefore(t, "0014_line_cues_only")
	exec(t, conn,
		`INSERT INTO songs (id, title, created_at, updated_at) VALUES (1, 'Midnight Drive', '', '')`,
		// Section 1, shared by Occurrences 1 and 2: a blank Line, then two
		// Lines. Its inactive Alternate's Lines come first, but don't count.
		`INSERT INTO sections (id, song_id, label) VALUES (1, 1, 'Chorus'), (2, 1, 'Verse'), (3, 1, 'Intro')`,
		`INSERT INTO alternates (id, section_id, active) VALUES (1, 1, 0), (2, 1, 1), (3, 2, 1), (4, 3, 1)`,
		`INSERT INTO lines (id, alternate_id, position, text) VALUES
			(1, 1, 0, 'Old words'),
			(2, 2, 0, ' ' || char(160)), (3, 2, 1, 'Drive, drive'), (4, 2, 2, 'all night'),
			(5, 3, 0, 'City lights')`,
		// Occurrence 1: cued, its first Line not. Occurrence 2: its first
		// Line cued already. Occurrence 3: the Verse, uncued. Occurrence 4:
		// the Intro, with no Lines.
		`INSERT INTO occurrences (id, song_id, section_id, position, cue_ms) VALUES
			(1, 1, 1, 0, 30000), (2, 1, 1, 1, 90000), (3, 1, 2, 2, NULL), (4, 1, 3, 3, 5000)`,
		`INSERT INTO line_cues (occurrence_id, line_id, cue_ms) VALUES (1, 4, 34000), (2, 3, 91000)`,
	)

	if err := migrateBefore(context.Background(), conn, "0016_no_shared_sections"); err != nil {
		t.Fatalf("migrating: %v", err)
	}

	type cue struct{ occurrence, line, ms int64 }
	var got []cue
	rows, err := conn.Query(`SELECT occurrence_id, line_id, cue_ms FROM line_cues ORDER BY occurrence_id, line_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var c cue
		if err := rows.Scan(&c.occurrence, &c.line, &c.ms); err != nil {
			t.Fatal(err)
		}
		got = append(got, c)
	}
	want := []cue{{1, 3, 30000}, {1, 4, 34000}, {2, 3, 91000}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("line cues = %v, want %v", got, want)
	}
	var columns int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('occurrences') WHERE name = 'cue_ms'`).Scan(&columns); err != nil {
		t.Fatal(err)
	}
	if columns != 0 {
		t.Errorf("occurrences still has a cue_ms column")
	}
}

func TestSharedSectionsKeepOnlyTheirFirstAppearance(t *testing.T) {
	conn := openBefore(t, "0016_no_shared_sections")
	exec(t, conn,
		`INSERT INTO songs (id, title, created_at, updated_at) VALUES (1, 'Midnight Drive', '', '')`,
		`INSERT INTO sections (id, song_id, label) VALUES (1, 1, 'Chorus'), (2, 1, 'Verse'), (3, 1, 'Bridge')`,
		`INSERT INTO alternates (id, section_id, active) VALUES (1, 1, 1), (2, 2, 1), (3, 3, 1)`,
		`INSERT INTO lines (id, alternate_id, position, text) VALUES
			(1, 1, 0, 'Drive, drive'), (2, 1, 1, 'all night'), (3, 2, 0, 'City lights')`,
		// The Chorus appears three times, first at position 1, though its
		// Occurrence with the lowest id is at position 4. The Verse appears
		// twice, and the Bridge, last, once.
		`INSERT INTO occurrences (id, song_id, section_id, position) VALUES
			(1, 1, 1, 4), (2, 1, 2, 0), (3, 1, 1, 1), (4, 1, 2, 2), (5, 1, 1, 3), (6, 1, 3, 5)`,
		`INSERT INTO line_cues (occurrence_id, line_id, cue_ms) VALUES
			(3, 1, 10000), (3, 2, 14000), (5, 1, 60000), (1, 2, 90000)`,
	)

	if err := migrate(context.Background(), conn); err != nil {
		t.Fatalf("migrating: %v", err)
	}

	type occurrence struct{ id, section, position int64 }
	var arrangement []occurrence
	rows, err := conn.Query(`SELECT id, section_id, position FROM occurrences ORDER BY position`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var o occurrence
		if err := rows.Scan(&o.id, &o.section, &o.position); err != nil {
			t.Fatal(err)
		}
		arrangement = append(arrangement, o)
	}
	wantArrangement := []occurrence{{2, 2, 0}, {3, 1, 1}, {6, 3, 2}}
	if !reflect.DeepEqual(arrangement, wantArrangement) {
		t.Errorf("arrangement = %v, want %v", arrangement, wantArrangement)
	}

	type cue struct{ occurrence, line, ms int64 }
	var cues []cue
	cueRows, err := conn.Query(`SELECT occurrence_id, line_id, cue_ms FROM line_cues ORDER BY occurrence_id, line_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer cueRows.Close()
	for cueRows.Next() {
		var c cue
		if err := cueRows.Scan(&c.occurrence, &c.line, &c.ms); err != nil {
			t.Fatal(err)
		}
		cues = append(cues, c)
	}
	if want := []cue{{3, 1, 10000}, {3, 2, 14000}}; !reflect.DeepEqual(cues, want) {
		t.Errorf("line cues = %v, want %v", cues, want)
	}

	var lines int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM lines`).Scan(&lines); err != nil {
		t.Fatal(err)
	}
	if lines != 3 {
		t.Errorf("lines = %d, want all 3 kept", lines)
	}
}
