package timeline

import (
	"context"
	"database/sql"
	"reflect"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/db"
	"github.com/xKirtle/bandmate/internal/domain"
	"github.com/xKirtle/bandmate/internal/song"
)

// newSong makes a Song with its first Track in a fresh database, and a Beat
// in the Beat Library, and returns the database, the Song's id, its Track's
// id and the Beat.
func newSong(t *testing.T) (*sql.DB, int64, int64, Beat) {
	t.Helper()
	ctx := context.Background()
	conn, err := db.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	s, err := song.NewStore(conn, nil, time.Now).CreateSong(ctx, "Night Drive", nil)
	if err != nil {
		t.Fatal(err)
	}
	beat := Beat{Title: "Four on the floor", FileName: "beat.wav", Size: 1024, Duration: 60}
	now := time.Now().UTC().Format(domain.TimeFormat)
	res, err := conn.ExecContext(ctx, `INSERT INTO beats (title, file_name, content_type, size, duration, peaks,
			created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		beat.Title, beat.FileName, "audio/wav", beat.Size, beat.Duration, "[]", now, now)
	if err != nil {
		t.Fatal(err)
	}
	if beat.ID, err = res.LastInsertId(); err != nil {
		t.Fatal(err)
	}
	var trackID int64
	if err := conn.QueryRowContext(ctx, `SELECT id FROM tracks WHERE song_id = ?`, s.ID).Scan(&trackID); err != nil {
		t.Fatal(err)
	}
	return conn, s.ID, trackID, beat
}

// detachedTake adds a Take of the Song, in no Clip, and returns it as the
// Timeline holds it.
func detachedTake(t *testing.T, conn *sql.DB, songID int64, number int) Take {
	t.Helper()
	ctx := context.Background()
	take := Take{Number: number, Size: 2048, Duration: 10, SampleRate: 48000,
		RecordedAt: time.Now().UTC().Truncate(time.Second)}
	res, err := conn.ExecContext(ctx, `INSERT INTO takes (song_id, number, size, duration, sample_rate, peaks,
			latency_offset, position, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		songID, take.Number, take.Size, take.Duration, take.SampleRate, "[]", 0, 0,
		take.RecordedAt.Format(domain.TimeFormat))
	if err != nil {
		t.Fatal(err)
	}
	if take.ID, err = res.LastInsertId(); err != nil {
		t.Fatal(err)
	}
	return take
}

// writeAndRead writes tl as the Song's Timeline through writeTimeline, in a
// transaction of its own, and returns its Tracks as read back.
func writeAndRead(t *testing.T, conn *sql.DB, songID int64, tl Timeline) []Track {
	t.Helper()
	ctx := context.Background()
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := writeTimeline(ctx, tx, songID, tl); err != nil {
		t.Fatalf("writing the Timeline: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	back, err := conn.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer back.Rollback()
	loaded, err := read(ctx, back, songID)
	if err != nil {
		t.Fatal(err)
	}
	return loaded.Tracks
}

// clipOfBeat is a Clip playing the whole of a Beat, as the Timeline holds
// it.
func clipOfBeat(id int64, beat Beat, start float64) Clip {
	return Clip{ID: id, BeatID: &beat.ID, ClipPlayback: asRecorded(), Takes: []Take{},
		Start: start, Length: beat.Duration}
}

func TestWriteTimelineRoundTrip(t *testing.T) {
	conn, songID, trackID, beat := newSong(t)
	takes := []Take{detachedTake(t, conn, songID, 1), detachedTake(t, conn, songID, 2)}

	named := "Riff"
	riff := clipOfBeat(1, beat, 0)
	riff.Name, riff.Gain, riff.Pitch, riff.FadeIn = &named, -6, 2, 1.5
	takeClip := Clip{ID: 2, Tempo: 1, Takes: takes, ActiveTakeID: &takes[1].ID, Start: 70, Length: 10}
	first := Timeline{Tracks: []Track{
		{ID: trackID, Name: "Track 1", Clips: []Clip{riff}},
		{ID: 2, Name: "Harmony", Volume: -3, Muted: true, Clips: []Clip{takeClip}},
	}}
	if got := writeAndRead(t, conn, songID, first); !reflect.DeepEqual(got, first.Tracks) {
		t.Fatalf("after writing new rows, loaded\n%+v\nwant\n%+v", got, first.Tracks)
	}

	// The Beat's Clip is trimmed and moved onto the other Track, the Clip of
	// Takes keeps one of its Takes, moved in its span, and the first Track goes.
	moved := riff
	moved.Start, moved.Offset, moved.Length = 20, 5, 15
	kept := takes[1]
	kept.Position = 2
	takeClip.Takes = []Take{kept}
	second := Timeline{Tracks: []Track{
		{ID: 2, Name: "Harmony", Volume: -3, Muted: true, Clips: []Clip{moved, takeClip}},
	}}
	if got := writeAndRead(t, conn, songID, second); !reflect.DeepEqual(got, second.Tracks) {
		t.Fatalf("after writing changed rows, loaded\n%+v\nwant\n%+v", got, second.Tracks)
	}

	// The Track left takes the place of the one that went, so the places
	// deleting a Track left behind close up, top to bottom as the Timeline
	// holds them.
	var position int64
	if err := conn.QueryRow(`SELECT position FROM tracks WHERE id = ?`, int64(2)).Scan(&position); err != nil {
		t.Fatal(err)
	}
	if position != 0 {
		t.Errorf("the Track left is %d from the top, want 0", position)
	}

	// The Take left out is out of its Clip, to be placed again.
	var in sql.NullInt64
	if err := conn.QueryRow(`SELECT clip_id FROM takes WHERE id = ?`, takes[0].ID).Scan(&in); err != nil {
		t.Fatal(err)
	}
	if in.Valid {
		t.Errorf("the Take left out is in Clip %d, want none", in.Int64)
	}
}

func TestStoredIDsNeverReuseAnID(t *testing.T) {
	conn, songID, trackID, beat := newSong(t)
	writeAndRead(t, conn, songID, Timeline{Tracks: []Track{
		{ID: trackID, Name: "Track 1", Clips: []Clip{clipOfBeat(1, beat, 0), clipOfBeat(2, beat, 70)}},
		{ID: 2, Name: "Harmony", Clips: []Clip{}},
	}})
	// The last-used ids are deleted, so the next ones mustn't take them.
	writeAndRead(t, conn, songID, Timeline{Tracks: []Track{
		{ID: trackID, Name: "Track 1", Clips: []Clip{clipOfBeat(1, beat, 0)}},
	}})

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
	got := []int64{ids.clip(), ids.clip(), ids.track()}
	if want := []int64{3, 4, 3}; !reflect.DeepEqual(got, want) {
		t.Errorf("new ids = %v, want %v", got, want)
	}
}
