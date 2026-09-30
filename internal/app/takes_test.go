package app_test

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
)

// Takes are recorded in the browser and uploaded as WAV files, each in a new
// Clip at its Track's append point. Deleting its Clip or Track only detaches
// a Take, and placing a Clip from its id brings it back, which is how undo
// works.

// wavRate is the sample rate the Takes in these tests are recorded at: low,
// to keep them small.
const wavRate = 8000

// wavFile is a WAV of the given length, as the browser encodes a Take when
// channels is 1 and bits 24. Each sample is different, to tell files apart.
func wavFile(seconds float64, channels, bits int) []byte {
	frames := int(seconds * wavRate)
	block := channels * bits / 8
	var b bytes.Buffer
	write := func(v any) { binary.Write(&b, binary.LittleEndian, v) }
	b.WriteString("RIFF")
	write(uint32(36 + frames*block))
	b.WriteString("WAVEfmt ")
	write(uint32(16))
	write(uint16(1))
	write(uint16(channels))
	write(uint32(wavRate))
	write(uint32(wavRate * block))
	write(uint16(block))
	write(uint16(bits))
	b.WriteString("data")
	write(uint32(frames * block))
	for i := range frames * block {
		b.WriteByte(byte(i * 7))
	}
	return b.Bytes()
}

// takeRecording is a Take lasting seconds recorded on a Track for a new
// Clip at start, with capture from captureStart and the latency offset
// taken off.
func takeRecording(trackID int64, start, captureStart, latency, seconds float64) audioUpload {
	return audioUpload{
		FileName:    "take.wav",
		ContentType: "audio/wav",
		Data:        wavFile(seconds, 1, 24),
		Details: map[string]any{
			"trackId": trackID, "start": start, "captureStart": captureStart, "latencyOffset": latency,
			"peaks": []float64{0.25, 0.5, 1},
		},
	}
}

// recordTake sends a Take recorded on a Song's Timeline.
func (ts *testServer) recordTake(songID int64, u audioUpload) response {
	ts.t.Helper()
	return ts.SendUpload(http.MethodPost, timelinePath(songID)+"/takes", u)
}

func takePath(songID, takeID int64) string {
	return fmt.Sprintf("/api/songs/%d/takes/%d", songID, takeID)
}

// takeFiles lists the files stored for Takes in the data directory.
func takeFiles(t *testing.T, ts *testServer) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(ts.DataDir, "audio", "takes"))
	if err != nil {
		t.Fatalf("reading audio directory: %v", err)
	}
	names := []string{}
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

// songWithVocalTrack is a Song with a 30-second Beat on Track 1 and
// an empty "Lead vox" Track below it.
func songWithVocalTrack(t *testing.T, ts *testServer) (song, timeline) {
	t.Helper()
	s := ts.createSong("Night Drive")
	timelineChange(t, ts.addBeatToSong(s.ID, ts.beatOfLength("Beat", 30).ID))
	return s, timelineChange(t, ts.addTrack(s.ID, "Lead vox"))
}

func TestARecordedTakeGoesInANewClipKeepingItsLeadInHidden(t *testing.T) {
	ts := newTestServer(t)
	s, tl := songWithVocalTrack(t, ts)
	beatTrack := tl.Tracks[0].ID
	upload := takeRecording(beatTrack, 30, 28, 0.25, 5)

	got := timelineChange(t, ts.recordTake(s.ID, upload))

	clips := got.Tracks[0].Clips
	if len(clips) != 2 {
		t.Fatalf("clips = %+v, want the Beat's and the Take's", clips)
	}
	c := clips[1]
	// Capture began 2s before the append point, and the Take was sung
	// 0.25s before the mic's audio came in: it starts 2.25s before the Clip,
	// and is heard from the Clip's start to its own end.
	if c.Start != 30 || c.Offset != 2.25 || c.Length != 2.75 || c.BeatID != 0 {
		t.Errorf("clip = %+v, want a Clip of Takes at 30 + 2.75, from 2.25s into its source", c)
	}
	if len(c.Takes) != 1 {
		t.Fatalf("takes = %+v, want the one recorded", c.Takes)
	}
	tk := c.Takes[0]
	want := take{ID: tk.ID, Number: 1, Size: int64(len(upload.Data)), Duration: 5, SampleRate: wavRate,
		LatencyOffset: 0.25, Position: 0, RecordedAt: tk.RecordedAt}
	if !reflect.DeepEqual(tk, want) || c.ActiveTakeID == nil || *c.ActiveTakeID != tk.ID {
		t.Errorf("take = %+v, active %v; want %+v, active", tk, c.ActiveTakeID, want)
	}
	if read := ts.getTimeline(s.ID); !reflect.DeepEqual(read, got) {
		t.Errorf("read timeline = %+v, want %+v", read, got)
	}

	var full take
	res := ts.Do(http.MethodGet, takePath(s.ID, tk.ID), nil)
	expectStatus(t, res, http.StatusOK)
	res.JSON(t, &full)
	if !reflect.DeepEqual(full.Peaks, []float64{0.25, 0.5, 1}) {
		t.Errorf("peaks = %v, want them as sent", full.Peaks)
	}
}

func TestATakesFileIsKeptAsUploadedWithRangeSupport(t *testing.T) {
	ts := newTestServer(t)
	s, tl := songWithVocalTrack(t, ts)
	upload := takeRecording(tl.Tracks[1].ID, 0, 0, 0, 1)
	got := timelineChange(t, ts.recordTake(s.ID, upload))
	id := got.Tracks[1].Clips[0].Takes[0].ID

	res := ts.Do(http.MethodGet, takePath(s.ID, id)+"/audio", nil)
	expectStatus(t, res, http.StatusOK)
	if !bytes.Equal(res.Body, upload.Data) || res.Header.Get("Content-Type") != "audio/wav" {
		t.Errorf("audio = %d bytes of %s, want the %d bytes uploaded as audio/wav",
			len(res.Body), res.Header.Get("Content-Type"), len(upload.Data))
	}
	ranged := ts.DoRaw(http.MethodGet, takePath(s.ID, id)+"/audio", http.Header{"Range": {"bytes=4-11"}}, nil)
	expectStatus(t, ranged, http.StatusPartialContent)
	if !bytes.Equal(ranged.Body, upload.Data[4:12]) {
		t.Errorf("range = %q, want %q", ranged.Body, upload.Data[4:12])
	}
	expectStatus(t, ts.Do(http.MethodGet, takePath(ts.createSong("Other").ID, id)+"/audio", nil), http.StatusNotFound)
}

func TestATakeOnAnEmptyTrackStartsAtTheStart(t *testing.T) {
	ts := newTestServer(t)
	s, tl := songWithVocalTrack(t, ts)

	// No lead-in before 0:00: capture starts with the Clip, and the latency
	// is all that's hidden.
	got := timelineChange(t, ts.recordTake(s.ID, takeRecording(tl.Tracks[1].ID, 0, 0, 0.25, 4)))

	c := got.Tracks[1].Clips[0]
	if c.Start != 0 || c.Offset != 0.25 || c.Length != 3.75 || c.Takes[0].Position != 0 {
		t.Errorf("clip = %+v, want it at 0:00 for 3.75s, 0.25s into its Take", c)
	}
}

func TestARecordingThatOverlapsAClipIsRefusedAndKeepsNothing(t *testing.T) {
	ts := newTestServer(t)
	s, tl := songWithVocalTrack(t, ts)

	expectError(t, ts.recordTake(s.ID, takeRecording(tl.Tracks[0].ID, 20, 18, 0, 5)),
		http.StatusConflict, "Clips can't overlap on a Track")

	if read := ts.getTimeline(s.ID); !reflect.DeepEqual(read, tl) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, tl)
	}
	if files := takeFiles(t, ts); len(files) != 0 {
		t.Errorf("take files = %q, want none", files)
	}
}

func TestARecordingBasedOnAnOldVersionKeepsNothing(t *testing.T) {
	ts := newTestServer(t)
	s, tl := songWithVocalTrack(t, ts)
	ts.updateSong(s.ID, map[string]any{"notes": "Edited in another tab"})

	expectStale(t, ts.SendUploadAt(tl.Version, http.MethodPost, timelinePath(s.ID)+"/takes",
		takeRecording(tl.Tracks[1].ID, 0, 0, 0, 2)))

	if files := takeFiles(t, ts); len(files) != 0 {
		t.Errorf("take files = %q, want none", files)
	}
}

func TestARecordingMustBeAMono24BitWavPlacedOnTheSongsTimeline(t *testing.T) {
	ts := newTestServer(t)
	s, tl := songWithVocalTrack(t, ts)
	vox := tl.Tracks[1].ID
	other := timelineChange(t, ts.addTrack(ts.createSong("Other").ID, "Elsewhere")).Tracks[0].ID
	with := func(u audioUpload, data []byte) audioUpload {
		u.Data = data
		return u
	}

	for name, c := range map[string]struct {
		upload audioUpload
		msg    string
	}{
		"in stereo":  {with(takeRecording(vox, 0, 0, 0, 1), wavFile(1, 2, 24)), "a Take must be a mono 24-bit WAV file"},
		"in 16 bits": {with(takeRecording(vox, 0, 0, 0, 1), wavFile(1, 1, 16)), "a Take must be a mono 24-bit WAV file"},
		"not a WAV":  {with(takeRecording(vox, 0, 0, 0, 1), []byte("ID3 an mp3")), "a Take must be a mono 24-bit WAV file"},
		"empty":      {with(takeRecording(vox, 0, 0, 0, 1), wavFile(0, 1, 24)), "duration must be more than 0 seconds"},
		"without peaks": {takeRecording(vox, 0, 0, 0, 1).with(map[string]any{"peaks": []float64{}}),
			"peaks are required"},
		"before 0:00": {takeRecording(vox, -1, 0, 0, 1), "a Clip can't start before 0:00"},
		"ending before its Clip": {takeRecording(vox, 10, 8, 0, 2),
			"the Take ended before its Clip's start"},
		"with a negative latency": {takeRecording(vox, 0, 0, -0.1, 1), "a latency offset can't be negative"},
		"on another Song's Track": {takeRecording(other, 0, 0, 0, 1), "there's no such Track on this Timeline"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.recordTake(s.ID, c.upload), http.StatusBadRequest, c.msg)
			if read := ts.getTimeline(s.ID); !reflect.DeepEqual(read, tl) {
				t.Errorf("timeline = %+v, want it unchanged: %+v", read, tl)
			}
		})
	}
	if files := takeFiles(t, ts); len(files) != 0 {
		t.Errorf("take files = %q, want none", files)
	}
}

// recordedTake is a Song whose "Lead vox" Track holds a Clip of one Take,
// 0:02 to 0:05 on the Timeline, trimmed to start 0.5s into it.
type recordedTake struct {
	song  song
	tl    timeline
	vox   track
	clip  clip
	take  take
	audio []byte
}

func recordATake(t *testing.T, ts *testServer) recordedTake {
	t.Helper()
	s, tl := songWithVocalTrack(t, ts)
	upload := takeRecording(tl.Tracks[1].ID, 0, 0, 0, 4)
	tl = timelineChange(t, ts.recordTake(s.ID, upload))
	c := tl.Tracks[1].Clips[0]
	timelineChange(t, ts.trimClip(s.ID, c.ID, 0.5, 3))
	tl = timelineChange(t, ts.moveClip(s.ID, c.ID, tl.Tracks[1].ID, 2))
	c = tl.Tracks[1].Clips[0]
	return recordedTake{song: s, tl: tl, vox: tl.Tracks[1], clip: c, take: c.Takes[0], audio: upload.Data}
}

func TestAClipOfTakesTrimsBackToItsLeadInAndOverrunButNoFurther(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)

	if c := r.clip; c.Start != 2 || c.Offset != 0.5 || c.Length != 3 {
		t.Errorf("clip = %+v, want it at 0:02 for 3s, 0.5s into its source", c)
	}
	// The Take's first 0.5s and last 0.5s are hidden; trimming back reveals
	// both, and the Take stays where it was on the Timeline.
	got := timelineChange(t, ts.trimClip(r.song.ID, r.clip.ID, 0, 4))
	if at := clipAt(got, r.clip.ID); at != "1:1.5+4@0" {
		t.Errorf("clip = %s, want the whole Take showing, 0:01.5 to 0:05.5", at)
	}
	if takes := got.Tracks[1].Clips[0].Takes; !reflect.DeepEqual(takes, []take{r.take}) {
		t.Errorf("takes = %+v, want the Take unchanged: %+v", takes, r.take)
	}
	for name, c := range map[string]struct {
		offset, length float64
		msg            string
	}{
		"before the Take's start": {-0.5, 4, "a Clip can't start before its source does"},
		"past the Take's end":     {0, 4.5, "a Clip can't play past the end of its source"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, ts.trimClip(r.song.ID, r.clip.ID, c.offset, c.length), http.StatusBadRequest, c.msg)
		})
	}
}

func TestAClipOfTakesTrimsWithinTheSpanOfAllItsTakes(t *testing.T) {
	ts := newTestServer(t)
	s, tl := songWithVocalTrack(t, ts)
	vox := tl.Tracks[1].ID
	short := timelineChange(t, ts.recordTake(s.ID, takeRecording(vox, 0, 0, 0, 4))).Tracks[1].Clips[0]
	long := timelineChange(t, ts.recordTake(s.ID, takeRecording(vox, 10, 10, 0, 6))).Tracks[1].Clips[1]
	timelineChange(t, ts.deleteClip(s.ID, short.ID))
	timelineChange(t, ts.deleteClip(s.ID, long.ID))
	ids := []int64{short.Takes[0].ID, long.Takes[0].ID}

	// Playing the shorter Take, the Clip still spans the longer one.
	expectError(t, ts.placeTakes(s.ID, vox, ids, ids[0], 0, 0, 6.5), http.StatusBadRequest,
		"a Clip can't play past the end of its source")
	got := timelineChange(t, ts.placeTakes(s.ID, vox, ids, ids[0], 0, 0, 5))
	c := got.Tracks[1].Clips[0]
	got = timelineChange(t, ts.trimClip(s.ID, c.ID, 0, 6))
	if at := clipAt(got, c.ID); at != "1:0+6@0" {
		t.Errorf("clip = %s, want it trimmed out to the longer Take's end", at)
	}
	expectError(t, ts.trimClip(s.ID, c.ID, 0, 6.5), http.StatusBadRequest, "a Clip can't play past the end of its source")
}

func TestAClipOfTakesMovesWithItsTakesAlongAndAcrossTracks(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	beatTrack := r.tl.Tracks[0].ID

	got := timelineChange(t, ts.moveClip(r.song.ID, r.clip.ID, r.vox.ID, 7.5))
	if at := clipAt(got, r.clip.ID); at != "1:7.5+3@0.5" {
		t.Errorf("clip = %s, want it moved to 0:07.5 with its trim", at)
	}
	// The Beat plays 0:00 to 0:30 on Track 1.
	expectError(t, ts.moveClip(r.song.ID, r.clip.ID, beatTrack, 28), http.StatusConflict, "Clips can't overlap on a Track")
	got = timelineChange(t, ts.moveClip(r.song.ID, r.clip.ID, beatTrack, 30))

	if at := clipAt(got, r.clip.ID); at != "0:30+3@0.5" {
		t.Errorf("clip = %s, want it on Track 1 at 0:30 with its trim", at)
	}
	moved := got.Tracks[0].Clips[1]
	if !reflect.DeepEqual(moved.Takes, []take{r.take}) || *moved.ActiveTakeID != r.take.ID {
		t.Errorf("takes = %+v, want the same Take, active: %+v", moved.Takes, r.take)
	}
	served := ts.Do(http.MethodGet, takePath(r.song.ID, r.take.ID)+"/audio", nil)
	if !bytes.Equal(served.Body, r.audio) {
		t.Errorf("audio after moving differs from the recording")
	}
}

func TestTrimmingAClipOfTakesIntoANeighbourIsRejected(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	// The copy plays at 0:05 to 0:08, touching the Clip.
	before := timelineChange(t, ts.duplicateClip(r.song.ID, r.clip.ID))
	dup := before.Tracks[1].Clips[1]

	expectError(t, ts.trimClip(r.song.ID, r.clip.ID, 0.5, 3.5), http.StatusConflict, "Clips can't overlap on a Track")
	expectError(t, ts.trimClip(r.song.ID, dup.ID, 0, 3.5), http.StatusConflict, "Clips can't overlap on a Track")

	if read := ts.getTimeline(r.song.ID); !reflect.DeepEqual(read, before) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, before)
	}
}

// placeTakes sends a request to place a Clip of detached Takes on a Track.
func (ts *testServer) placeTakes(songID, trackID int64, takeIDs []int64, active int64, start, offset, length float64) response {
	ts.t.Helper()
	return ts.placeClip(songID, map[string]any{
		"trackId": trackID, "takeIds": takeIDs, "activeTakeId": active, "start": start, "offset": offset, "length": length,
	})
}

func TestADeletedClipsTakesAreDetachedAndCanBePlacedAgain(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)

	gone := timelineChange(t, ts.deleteClip(r.song.ID, r.clip.ID))
	if len(gone.Tracks[1].Clips) != 0 {
		t.Fatalf("clips = %+v, want the Clip gone", gone.Tracks[1].Clips)
	}
	expectStatus(t, ts.Do(http.MethodGet, takePath(r.song.ID, r.take.ID), nil), http.StatusOK)

	back := timelineChange(t, ts.placeTakes(r.song.ID, r.vox.ID, []int64{r.take.ID}, r.take.ID, 2, 0.5, 3))

	c := back.Tracks[1].Clips[0]
	if c.ID == r.clip.ID || c.Start != 2 || c.Offset != 0.5 || c.Length != 3 {
		t.Errorf("clip = %+v, want a new Clip placed as the old one was", c)
	}
	if !reflect.DeepEqual(c.Takes, []take{r.take}) || *c.ActiveTakeID != r.take.ID {
		t.Errorf("takes = %+v, want the same Take back, active: %+v", c.Takes, r.take)
	}
	served := ts.Do(http.MethodGet, takePath(r.song.ID, r.take.ID)+"/audio", nil)
	if !bytes.Equal(served.Body, r.audio) {
		t.Errorf("audio after coming back differs from the recording")
	}
}

func TestADeletedTracksTakesComeBackWithIt(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)

	timelineChange(t, ts.deleteTrack(r.song.ID, r.vox.ID))
	back := timelineChange(t, ts.Do(http.MethodPost, timelinePath(r.song.ID)+"/tracks", map[string]any{
		"name": "Lead vox", "position": 1,
		"clips": []map[string]any{
			{"takeIds": []int64{r.take.ID}, "activeTakeId": r.take.ID, "start": 2, "offset": 0.5, "length": 3},
		},
	}))

	c := back.Tracks[1].Clips[0]
	if !reflect.DeepEqual(c.Takes, []take{r.take}) || c.Start != 2 {
		t.Errorf("clip = %+v, want the Take back at 0:02: %+v", c, r.take)
	}
}

func TestPlacingTakesFollowsTheirRules(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)
	other := recordATake(t, ts)
	timelineChange(t, ts.deleteClip(other.song.ID, other.clip.ID))

	for name, c := range map[string]struct {
		res    response
		status int
		msg    string
	}{
		"already in a Clip": {ts.placeTakes(r.song.ID, r.vox.ID, []int64{r.take.ID}, r.take.ID, 10, 0, 1),
			http.StatusConflict, "a Take can only be in one Clip"},
		"of another Song": {ts.placeTakes(r.song.ID, r.vox.ID, []int64{other.take.ID}, other.take.ID, 10, 0, 1),
			http.StatusBadRequest, "there's no such Take in this Song"},
		"playing none of them": {ts.placeTakes(r.song.ID, r.vox.ID, []int64{r.take.ID}, 999, 10, 0, 1),
			http.StatusBadRequest, "a Clip of Takes plays one of them"},
		"with a Beat too": {ts.placeClip(r.song.ID, map[string]any{"trackId": r.vox.ID, "beatId": r.tl.Beats[0].ID,
			"takeIds": []int64{r.take.ID}, "activeTakeId": r.take.ID, "start": 10, "offset": 0, "length": 1}),
			http.StatusBadRequest, "a Clip plays one of a Beat, a Sound or Takes"},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, c.res, c.status, c.msg)
		})
	}
	if read := ts.getTimeline(r.song.ID); !reflect.DeepEqual(read, r.tl) {
		t.Errorf("timeline = %+v, want it unchanged: %+v", read, r.tl)
	}
}

func TestADuplicatedClipOfTakesHasCopiesOfThem(t *testing.T) {
	ts := newTestServer(t)
	r := recordATake(t, ts)

	got := timelineChange(t, ts.duplicateClip(r.song.ID, r.clip.ID))

	clips := got.Tracks[1].Clips
	if len(clips) != 2 || clips[1].Start != 5 || clips[1].Offset != 0.5 || clips[1].Length != 3 {
		t.Fatalf("clips = %+v, want a copy right after the Clip", clips)
	}
	copied := clips[1].Takes
	if len(copied) != 1 || copied[0].ID == r.take.ID || *clips[1].ActiveTakeID != copied[0].ID {
		t.Fatalf("takes = %+v, want a copy of the Take, active", copied)
	}
	if want := (take{ID: copied[0].ID, Number: 1, Size: r.take.Size, Duration: 4, SampleRate: wavRate,
		Position: r.take.Position, RecordedAt: r.take.RecordedAt}); !reflect.DeepEqual(copied[0], want) {
		t.Errorf("copy = %+v, want %+v", copied[0], want)
	}
	served := ts.Do(http.MethodGet, takePath(r.song.ID, copied[0].ID)+"/audio", nil)
	if !bytes.Equal(served.Body, r.audio) {
		t.Errorf("the copy's audio differs from the recording")
	}
	// Deleting either keeps the other's file.
	timelineChange(t, ts.deleteClip(r.song.ID, clips[1].ID))
	if served := ts.Do(http.MethodGet, takePath(r.song.ID, r.take.ID)+"/audio", nil); !bytes.Equal(served.Body, r.audio) {
		t.Errorf("the original's audio after deleting the copy differs from the recording")
	}
	back := timelineChange(t, ts.placeTakes(r.song.ID, r.vox.ID, []int64{copied[0].ID}, copied[0].ID, 5, 0.5, 3))
	timelineChange(t, ts.deleteClip(r.song.ID, r.clip.ID))
	served = ts.Do(http.MethodGet, takePath(r.song.ID, back.Tracks[1].Clips[1].Takes[0].ID)+"/audio", nil)
	if !bytes.Equal(served.Body, r.audio) {
		t.Errorf("the copy's audio after deleting the original differs from the recording")
	}
}

func TestDeletingASongDeletesItsTakesAndTheirFiles(t *testing.T) {
	ts := newTestServer(t)
	gone := recordATake(t, ts)
	// One of its Takes is detached, and still goes.
	dup := timelineChange(t, ts.duplicateClip(gone.song.ID, gone.clip.ID))
	timelineChange(t, ts.deleteClip(gone.song.ID, dup.Tracks[1].Clips[1].ID))
	kept := recordATake(t, ts)

	expectStatus(t, ts.Do(http.MethodDelete, songPath(gone.song.ID), nil), http.StatusNoContent)

	if files := takeFiles(t, ts); !reflect.DeepEqual(files, []string{fmt.Sprint(kept.take.ID)}) {
		t.Errorf("take files on disk = %q, want only the kept Song's", files)
	}
	expectStatus(t, ts.Do(http.MethodGet, takePath(gone.song.ID, gone.take.ID), nil), http.StatusNotFound)
}

// startAt restarts the server on the same data directory as if it were now
// plus some time, as a later startup.
func (ts *testServer) startAt(later time.Duration) *testServer {
	ts.t.Helper()
	ts.Stop()
	return startTestServer(ts.t, ts.DataDir, func(c *app.Config) {
		c.Now = func() time.Time { return time.Now().Add(later) }
	})
}

func TestStartupSweepsTakesDetachedForMoreThanADay(t *testing.T) {
	ts := newTestServer(t)
	placed := recordATake(t, ts)
	// A second Take in the Clip, detached by deleting it.
	retaken := timelineChange(t, ts.retake(placed.song.ID, placed.clip.ID, retakeUpload(0, 0, 4)))
	deleted := retaken.Tracks[1].Clips[0].Takes[1]
	timelineChange(t, ts.deleteTake(placed.song.ID, placed.clip.ID, deleted.ID))
	// A copy of the Take left, sharing its file, detached with its Clip.
	dup := timelineChange(t, ts.duplicateClip(placed.song.ID, placed.clip.ID))
	timelineChange(t, ts.deleteClip(placed.song.ID, dup.Tracks[1].Clips[1].ID))
	copied := dup.Tracks[1].Clips[1].Takes[0]
	// A Take detached with its Track.
	other := recordATake(t, ts)
	timelineChange(t, ts.deleteTrack(other.song.ID, other.vox.ID))

	ts = ts.startAt(23 * time.Hour)
	for _, tk := range []struct{ song, take int64 }{
		{placed.song.ID, placed.take.ID}, {placed.song.ID, deleted.ID}, {placed.song.ID, copied.ID},
		{other.song.ID, other.take.ID},
	} {
		expectStatus(t, ts.Do(http.MethodGet, takePath(tk.song, tk.take), nil), http.StatusOK)
	}
	if files := takeFiles(t, ts); len(files) != 4 {
		t.Errorf("take files on disk = %q, want all four kept within a day", files)
	}

	ts = ts.startAt(25 * time.Hour)
	expectStatus(t, ts.Do(http.MethodGet, takePath(placed.song.ID, deleted.ID), nil), http.StatusNotFound)
	expectStatus(t, ts.Do(http.MethodGet, takePath(placed.song.ID, copied.ID), nil), http.StatusNotFound)
	expectStatus(t, ts.Do(http.MethodGet, takePath(other.song.ID, other.take.ID), nil), http.StatusNotFound)
	if files := takeFiles(t, ts); !reflect.DeepEqual(files, []string{fmt.Sprint(placed.take.ID)}) {
		t.Errorf("take files on disk = %q, want only the one still in a Clip", files)
	}
	if takes := ts.getTimeline(placed.song.ID).Tracks[1].Clips[0].Takes; len(takes) != 1 || takes[0].ID != placed.take.ID {
		t.Errorf("takes = %+v, want the Take still in its Clip", takes)
	}
	if served := ts.Do(http.MethodGet, takePath(placed.song.ID, placed.take.ID)+"/audio", nil); !bytes.Equal(served.Body, placed.audio) {
		t.Errorf("the kept Take's audio differs from the recording, after its copy was swept")
	}
}
