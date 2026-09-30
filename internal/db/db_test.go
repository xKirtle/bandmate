package db

import (
	"context"
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"
	"time"
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

// cue is one row of line_cues.
type cue struct{ occurrence, line, ms int64 }

// lineCues reads every Line Cue, by Occurrence then Line.
func lineCues(t *testing.T, conn *sql.DB) []cue {
	t.Helper()
	var cues []cue
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
		cues = append(cues, c)
	}
	return cues
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

	got := lineCues(t, conn)
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

	if err := migrateBefore(context.Background(), conn, "0017_sections_in_arrangement"); err != nil {
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

	cues := lineCues(t, conn)
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

func TestOccurrencesCollapseIntoSections(t *testing.T) {
	conn := openBefore(t, "0017_sections_in_arrangement")
	exec(t, conn,
		`INSERT INTO songs (id, title, created_at, updated_at) VALUES (1, 'Midnight Drive', '', '')`,
		// The Verse and Chorus are in the Arrangement, the Bridge in the
		// Scrapbook. The Chorus has an inactive Alternate with a dormant Cue.
		`INSERT INTO sections (id, song_id, label) VALUES (1, 1, 'Chorus'), (2, 1, 'Verse'), (3, 1, 'Bridge')`,
		`INSERT INTO alternates (id, section_id, active) VALUES (1, 1, 1), (2, 1, 0), (3, 2, 1), (4, 3, 1)`,
		`INSERT INTO lines (id, alternate_id, position, text) VALUES
			(1, 1, 0, 'Drive, drive'), (2, 1, 1, 'all night'), (3, 2, 0, 'Old words'),
			(4, 3, 0, 'City lights'), (5, 4, 0, 'Somewhere else')`,
		`INSERT INTO occurrences (id, song_id, section_id, position) VALUES (10, 1, 2, 0), (11, 1, 1, 1)`,
		`INSERT INTO line_cues (occurrence_id, line_id, cue_ms) VALUES
			(10, 4, 5000), (11, 1, 30000), (11, 3, 31000)`,
	)

	if err := migrate(context.Background(), conn); err != nil {
		t.Fatalf("migrating: %v", err)
	}

	type section struct {
		id       int64
		position sql.NullInt64
	}
	var sections []section
	rows, err := conn.Query(`SELECT id, position FROM sections ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var s section
		if err := rows.Scan(&s.id, &s.position); err != nil {
			t.Fatal(err)
		}
		sections = append(sections, s)
	}
	wantSections := []section{{1, sql.NullInt64{Int64: 1, Valid: true}}, {2, sql.NullInt64{Int64: 0, Valid: true}}, {3, sql.NullInt64{}}}
	if !reflect.DeepEqual(sections, wantSections) {
		t.Errorf("sections = %v, want %v", sections, wantSections)
	}

	type lineCue struct {
		line int64
		ms   sql.NullInt64
	}
	var cues []lineCue
	rows, err = conn.Query(`SELECT id, cue_ms FROM lines ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var c lineCue
		if err := rows.Scan(&c.line, &c.ms); err != nil {
			t.Fatal(err)
		}
		cues = append(cues, c)
	}
	ms := func(v int64) sql.NullInt64 { return sql.NullInt64{Int64: v, Valid: true} }
	wantCues := []lineCue{{1, ms(30000)}, {2, sql.NullInt64{}}, {3, ms(31000)}, {4, ms(5000)}, {5, sql.NullInt64{}}}
	if !reflect.DeepEqual(cues, wantCues) {
		t.Errorf("line cues = %v, want %v", cues, wantCues)
	}

	var tables int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM sqlite_master
		WHERE type = 'table' AND name IN ('occurrences', 'line_cues')`).Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if tables != 0 {
		t.Errorf("occurrences and line_cues still exist")
	}
}

func TestClipsKeepTheirIdsAsTheyMayPlayTakes(t *testing.T) {
	conn := openBefore(t, "0019_takes")
	exec(t, conn,
		`INSERT INTO songs (id, title, created_at, updated_at) VALUES (1, 'Midnight Drive', '', '')`,
		`INSERT INTO beats (id, title, file_name, content_type, size, duration, peaks, created_at, updated_at)
			VALUES (1, 'Beat', 'beat.mp3', 'audio/mpeg', 10, 30, '[]', '', '')`,
		`INSERT INTO tracks (id, song_id, name, position) VALUES (1, 1, 'Beat', 0)`,
		`INSERT INTO clips (track_id, beat_id, start, source_offset, length) VALUES
			(1, 1, 0, 0, 30), (1, 1, 30, 5, 10), (1, 1, 40, 0, 30)`,
		// The latest Clip, deleted: its id is never given out again.
		`DELETE FROM clips WHERE id = 3`,
	)

	if err := migrate(context.Background(), conn); err != nil {
		t.Fatalf("migrating: %v", err)
	}

	type clip struct {
		id, beat    int64
		start, trim float64
	}
	var clips []clip
	rows, err := conn.Query(`SELECT id, beat_id, start, source_offset FROM clips ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var c clip
		if err := rows.Scan(&c.id, &c.beat, &c.start, &c.trim); err != nil {
			t.Fatal(err)
		}
		clips = append(clips, c)
	}
	if want := []clip{{1, 1, 0, 0}, {2, 1, 30, 5}}; !reflect.DeepEqual(clips, want) {
		t.Errorf("clips = %v, want %v", clips, want)
	}

	res, err := conn.Exec(`INSERT INTO clips (track_id, beat_id, start, source_offset, length) VALUES (1, 1, 70, 0, 1)`)
	if err != nil {
		t.Fatal(err)
	}
	if id, _ := res.LastInsertId(); id != 4 {
		t.Errorf("next clip id = %d, want 4", id)
	}
	if _, err := conn.Exec(`INSERT INTO clips (track_id, start, source_offset, length) VALUES (1, 80, 0, 1)`); err == nil {
		t.Errorf("a Clip playing neither a Beat nor Takes was stored")
	}
}

func TestAClipOfTakesKnowsTheHighestNumberItsTakesHave(t *testing.T) {
	conn := openBefore(t, "0020_last_take_number")
	exec(t, conn,
		`INSERT INTO songs (id, title, created_at, updated_at) VALUES (1, 'Midnight Drive', '', '')`,
		`INSERT INTO beats (id, title, file_name, content_type, size, duration, peaks, created_at, updated_at)
			VALUES (1, 'Beat', 'beat.mp3', 'audio/mpeg', 10, 30, '[]', '', '')`,
		`INSERT INTO tracks (id, song_id, name, position) VALUES (1, 1, 'Vox', 0)`,
		`INSERT INTO takes (id, song_id, number, size, duration, sample_rate, peaks, latency_offset, position, recorded_at)
			VALUES (1, 1, 1, 10, 4, 48000, '[]', 0, 0, ''), (2, 1, 3, 10, 4, 48000, '[]', 0, 0, '')`,
		`INSERT INTO clips (id, track_id, beat_id, active_take_id, start, source_offset, length) VALUES
			(1, 1, NULL, 2, 0, 0, 4), (2, 1, 1, NULL, 10, 0, 30)`,
		`UPDATE takes SET clip_id = 1`,
	)

	if err := migrate(context.Background(), conn); err != nil {
		t.Fatalf("migrating: %v", err)
	}

	var numbers []int
	rows, err := conn.Query(`SELECT last_take_number FROM clips ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var n int
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		numbers = append(numbers, n)
	}
	if want := []int{3, 0}; !reflect.DeepEqual(numbers, want) {
		t.Errorf("last take numbers = %v, want %v", numbers, want)
	}
}

func TestEverySongWithoutATrackGetsTrack1(t *testing.T) {
	conn := openBefore(t, "0022_default_track")
	exec(t, conn,
		`INSERT INTO songs (id, title, created_at, updated_at) VALUES (1, 'Midnight Drive', '', ''), (2, 'Neon', '', '')`,
		`INSERT INTO tracks (id, song_id, name, position) VALUES (1, 2, 'Vox', 0)`,
	)

	if err := migrate(context.Background(), conn); err != nil {
		t.Fatalf("migrating: %v", err)
	}

	type row struct {
		song     int64
		name     string
		position int
	}
	var tracks []row
	rows, err := conn.Query(`SELECT song_id, name, position FROM tracks ORDER BY song_id, position`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.song, &r.name, &r.position); err != nil {
			t.Fatal(err)
		}
		tracks = append(tracks, r)
	}
	if want := []row{{1, "Track 1", 0}, {2, "Vox", 0}}; !reflect.DeepEqual(tracks, want) {
		t.Errorf("tracks = %+v, want %+v", tracks, want)
	}
}

func TestExistingClipsAreUnnamed(t *testing.T) {
	conn := openBefore(t, "0023_clip_names")
	exec(t, conn,
		`INSERT INTO songs (id, title, created_at, updated_at) VALUES (1, 'Midnight Drive', '', '')`,
		`INSERT INTO beats (id, title, file_name, content_type, size, duration, peaks, created_at, updated_at)
			VALUES (1, 'Beat', 'beat.mp3', 'audio/mpeg', 10, 30, '[]', '', '')`,
		`INSERT INTO tracks (id, song_id, name, position) VALUES (1, 1, 'Beat', 0)`,
		`INSERT INTO clips (id, track_id, beat_id, start, source_offset, length) VALUES (1, 1, 1, 2, 5, 10)`,
	)

	if err := migrate(context.Background(), conn); err != nil {
		t.Fatalf("migrating: %v", err)
	}

	type clip struct {
		id, beat              int64
		start, offset, length float64
		name                  sql.NullString
	}
	var c clip
	if err := conn.QueryRow(`SELECT id, beat_id, start, source_offset, length, name FROM clips`).
		Scan(&c.id, &c.beat, &c.start, &c.offset, &c.length, &c.name); err != nil {
		t.Fatal(err)
	}
	if want := (clip{1, 1, 2, 5, 10, sql.NullString{}}); c != want {
		t.Errorf("clip = %+v, want %+v", c, want)
	}
}

func TestExistingBeatAndTakeClipsAreCarriedOverUntouchedBySounds(t *testing.T) {
	conn := openBefore(t, "0024_sounds")
	exec(t, conn,
		`INSERT INTO songs (id, title, created_at, updated_at) VALUES (1, 'Midnight Drive', '', '')`,
		`INSERT INTO beats (id, title, file_name, content_type, size, duration, peaks, created_at, updated_at)
			VALUES (1, 'Beat', 'beat.mp3', 'audio/mpeg', 10, 30, '[]', '', '')`,
		`INSERT INTO tracks (id, song_id, name, position) VALUES (1, 1, 'Beat', 0)`,
		`INSERT INTO takes (id, song_id, number, size, duration, sample_rate, peaks, latency_offset, position, recorded_at, detached_at)
			VALUES (1, 1, 2, 10, 4, 48000, '[]', 0, 0, '', NULL), (2, 1, 1, 10, 4, 48000, '[]', 0, 0, '', 'yesterday')`,
		`INSERT INTO clips (id, track_id, beat_id, active_take_id, last_take_number, name, start, source_offset, length) VALUES
			(1, 1, 1, NULL, 0, 'Intro', 2, 5, 10), (2, 1, NULL, 1, 3, NULL, 20, 0, 4), (3, 1, 1, NULL, 0, NULL, 40, 0, 1)`,
		`UPDATE takes SET clip_id = 2 WHERE id = 1`,
		// The latest Clip, deleted: its id is never given out again.
		`DELETE FROM clips WHERE id = 3`,
	)

	if err := migrate(context.Background(), conn); err != nil {
		t.Fatalf("migrating: %v", err)
	}

	type clip struct {
		id, track             int64
		beat, take, sound     sql.NullInt64
		last                  int
		name                  sql.NullString
		start, offset, length float64
	}
	var clips []clip
	rows, err := conn.Query(`SELECT id, track_id, beat_id, active_take_id, sound_id, last_take_number, name,
		start, source_offset, length FROM clips ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var c clip
		if err := rows.Scan(&c.id, &c.track, &c.beat, &c.take, &c.sound, &c.last, &c.name, &c.start, &c.offset, &c.length); err != nil {
			t.Fatal(err)
		}
		clips = append(clips, c)
	}
	rows.Close()
	id := func(n int64) sql.NullInt64 { return sql.NullInt64{Int64: n, Valid: true} }
	none := sql.NullInt64{}
	want := []clip{
		{1, 1, id(1), none, none, 0, sql.NullString{String: "Intro", Valid: true}, 2, 5, 10},
		{2, 1, none, id(1), none, 3, sql.NullString{}, 20, 0, 4},
	}
	if !reflect.DeepEqual(clips, want) {
		t.Errorf("clips = %+v, want %+v", clips, want)
	}

	type take struct {
		id       int64
		clip     sql.NullInt64
		detached sql.NullString
	}
	var takes []take
	rows, err = conn.Query(`SELECT id, clip_id, detached_at FROM takes ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var tk take
		if err := rows.Scan(&tk.id, &tk.clip, &tk.detached); err != nil {
			t.Fatal(err)
		}
		takes = append(takes, tk)
	}
	rows.Close()
	if want := []take{{1, id(2), sql.NullString{}}, {2, none, sql.NullString{String: "yesterday", Valid: true}}}; !reflect.DeepEqual(takes, want) {
		t.Errorf("takes = %+v, want the Take still in its Clip, and the detached one still detached: %+v", takes, want)
	}

	exec(t, conn, `INSERT INTO sounds (id, song_id, name, file_name, content_type, size, duration, peaks, added_at)
		VALUES (1, 1, 'Hum', 'hum.m4a', 'audio/mp4', 10, 8, '[]', '')`)
	res, err := conn.Exec(`INSERT INTO clips (track_id, sound_id, start, source_offset, length) VALUES (1, 1, 70, 0, 1)`)
	if err != nil {
		t.Fatalf("placing a Clip of a Sound: %v", err)
	}
	if id, _ := res.LastInsertId(); id != 4 {
		t.Errorf("next clip id = %d, want 4", id)
	}
	for _, stmt := range []string{
		`INSERT INTO clips (track_id, start, source_offset, length) VALUES (1, 80, 0, 1)`,
		`INSERT INTO clips (track_id, beat_id, sound_id, start, source_offset, length) VALUES (1, 1, 1, 80, 0, 1)`,
	} {
		if _, err := conn.Exec(stmt); err == nil {
			t.Errorf("%s: stored a Clip that doesn't play exactly one source", stmt)
		}
	}
}

func TestExistingSoundsNoClipUsesAreUnusedFromTheMigration(t *testing.T) {
	conn := openBefore(t, "0025_unused_sounds")
	exec(t, conn,
		`INSERT INTO songs (id, title, created_at, updated_at) VALUES (1, 'Midnight Drive', '', '')`,
		`INSERT INTO tracks (id, song_id, name, position) VALUES (1, 1, 'Track 1', 0)`,
		`INSERT INTO sounds (id, song_id, name, file_name, content_type, size, duration, peaks, added_at) VALUES
			(1, 1, 'Hum', 'hum.m4a', 'audio/mp4', 10, 8, '[]', '2020-01-01T00:00:00.000000000Z'),
			(2, 1, 'Riff', 'riff.wav', 'audio/wav', 10, 3, '[]', '2020-01-01T00:00:00.000000000Z')`,
		`INSERT INTO clips (track_id, sound_id, start, source_offset, length) VALUES (1, 1, 0, 0, 8)`,
	)
	before := time.Now().UTC().Truncate(time.Second)

	if err := migrate(context.Background(), conn); err != nil {
		t.Fatalf("migrating: %v", err)
	}

	var used, unused sql.NullString
	if err := conn.QueryRow(`SELECT unused_since FROM sounds WHERE id = 1`).Scan(&used); err != nil {
		t.Fatal(err)
	}
	if used.Valid {
		t.Errorf("unused_since of the Sound in a Clip = %q, want none", used.String)
	}
	if err := conn.QueryRow(`SELECT unused_since FROM sounds WHERE id = 2`).Scan(&unused); err != nil {
		t.Fatal(err)
	}
	since, err := time.Parse("2006-01-02T15:04:05.000000000Z", unused.String)
	if err != nil || since.Before(before) || since.After(time.Now()) {
		t.Errorf("unused_since of the Sound no Clip uses = %q, want the time it was migrated at", unused.String)
	}
}
