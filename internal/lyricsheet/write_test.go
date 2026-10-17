package lyricsheet

import (
	"context"
	"database/sql"
	"reflect"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/db"
)

// cue is a Cue of seconds, as a Line holds it.
func cue(seconds float64) *float64 { return &seconds }

// line is a Line of text, read as a Song's are, with cue as its Cue.
func line(id int64, text string, cue *float64) Line {
	var ms sql.NullInt64
	if cue != nil {
		ms = sql.NullInt64{Int64: millis(*cue), Valid: true}
	}
	return newLine(id, text, ms)
}

// newSong makes a Song with an empty Lyric Sheet in a fresh database, and
// returns the database and the Song's id.
func newSong(t *testing.T) (*sql.DB, int64) {
	t.Helper()
	ctx := context.Background()
	conn, err := db.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	song, err := NewStore(conn, nil, time.Now).CreateSong(ctx, "Song", nil)
	if err != nil {
		t.Fatal(err)
	}
	return conn, song.ID
}

// write writes sheet as the Song's Lyric Sheet through writeSheet, in a
// transaction of its own, and returns the sheet as loaded back.
func write(t *testing.T, conn *sql.DB, songID int64, sheet LyricSheet) LyricSheet {
	t.Helper()
	ctx := context.Background()
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := writeSheet(ctx, tx, songID, sheet); err != nil {
		t.Fatalf("writing the sheet: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadLyricSheet(ctx, conn, songID)
	if err != nil {
		t.Fatal(err)
	}
	return loaded
}

func TestWriteSheetRoundTrip(t *testing.T) {
	conn, songID := newSong(t)

	first := LyricSheet{
		Arrangement: []int64{1, 2},
		Scrapbook:   []int64{3},
		Sections: []Section{
			{ID: 1, Label: "Verse", Alternates: []Alternate{
				{ID: 1, Active: true, Lines: []Line{
					line(1, "Hel[Am]lo", cue(1.5)),
					line(2, "world", nil),
				}},
				{ID: 2, Name: "Darker", Lines: []Line{line(3, "Good[Em]bye", cue(2.25))}},
			}},
			{ID: 2, Label: "Chorus", Alternates: []Alternate{
				{ID: 3, Active: true, Lines: []Line{line(4, "Sing it", cue(8))}},
				{ID: 7, Name: "Quiet", Lines: []Line{line(8, "Hum it", nil)}},
			}},
			{ID: 3, Label: "Bridge", Alternates: []Alternate{
				{ID: 4, Active: true, Lines: []Line{line(5, "Spare", nil)}},
			}},
		},
	}
	if got := write(t, conn, songID, first); !reflect.DeepEqual(got, first) {
		t.Fatalf("after writing new rows, loaded\n%+v\nwant\n%+v", got, first)
	}

	// Renamed, moved and deleted rows, and new ones.
	second := LyricSheet{
		Arrangement: []int64{4, 1},
		Scrapbook:   []int64{2},
		Sections: []Section{
			// Renamed; "Darker" now active, its Line moved to the end, and
			// a Line of the deleted Bridge moved in.
			{ID: 1, Label: "Verse 1", Alternates: []Alternate{
				{ID: 1, Lines: []Line{
					line(2, "world!", nil),
					line(1, "Hel[Am]lo", cue(3)),
				}},
				{ID: 2, Name: "Brighter", Active: true, Lines: []Line{
					line(5, "Spare", nil),
					line(3, "Good[Em]bye", cue(2.25)),
				}},
			}},
			// Out to the Scrapbook, with a new Alternate made active, the
			// deleted Bridge's moved in, and "Quiet" deleted.
			{ID: 2, Label: "Chorus", Alternates: []Alternate{
				{ID: 3, Lines: []Line{line(4, "Sing it", cue(8))}},
				{ID: 4, Lines: []Line{}},
				{ID: 6, Active: true, Lines: []Line{line(7, "Sing it louder", nil)}},
			}},
			// New, first in the Arrangement.
			{ID: 4, Label: "Intro", Alternates: []Alternate{
				{ID: 5, Active: true, Lines: []Line{line(6, "[C] [G]", cue(0))}},
			}},
		},
	}
	if got := write(t, conn, songID, second); !reflect.DeepEqual(got, second) {
		t.Fatalf("after writing changed rows, loaded\n%+v\nwant\n%+v", got, second)
	}
}

func TestStoredIDsNeverReuseAnID(t *testing.T) {
	conn, songID := newSong(t)
	write(t, conn, songID, LyricSheet{
		Arrangement: []int64{1, 2},
		Scrapbook:   []int64{},
		Sections: []Section{
			{ID: 1, Alternates: []Alternate{{ID: 1, Active: true, Lines: []Line{line(1, "a", nil)}}}},
			{ID: 2, Alternates: []Alternate{{ID: 2, Active: true, Lines: []Line{line(2, "b", nil)}}}},
		},
	})
	// The last-used ids are deleted, so the next ones mustn't take them.
	write(t, conn, songID, LyricSheet{
		Arrangement: []int64{1},
		Scrapbook:   []int64{},
		Sections:    []Section{{ID: 1, Alternates: []Alternate{{ID: 1, Active: true, Lines: []Line{}}}}},
	})

	ctx := context.Background()
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	ids, err := storedIDs(ctx, tx)
	if err != nil {
		t.Fatal(err)
	}
	got := []int64{ids.section(), ids.section(), ids.alternate(), ids.line(), ids.line()}
	if want := []int64{3, 4, 3, 3, 4}; !reflect.DeepEqual(got, want) {
		t.Errorf("new ids = %v, want %v", got, want)
	}
}
