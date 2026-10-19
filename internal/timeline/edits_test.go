package timeline

import (
	"reflect"
	"testing"

	"github.com/xKirtle/bandmate/internal/domain"
)

// The edits that change a Track or how a Clip plays, and the two that build
// a Timeline out of several edits at once, on plain Timeline values, beside
// the placement edits in placement_test.go. They were reachable only
// through the HTTP server until the Timeline's own tests took them over
// (ADR 0025).

// playback is how one of tl's Clips plays: its name, Gain, Pitch, Tempo and
// Fades, which no placement edit should change by itself.
type playback struct {
	name               string
	gain, pitch, tempo float64
	fadeIn, fadeOut    float64
}

// playbackOf is how c plays, "" for a Clip with no name of its own.
func playbackOf(c Clip) playback {
	p := playback{gain: c.Gain, pitch: c.Pitch, tempo: c.Tempo, fadeIn: c.FadeIn, fadeOut: c.FadeOut}
	if c.Name != nil {
		p.name = *c.Name
	}
	return p
}

// playing is c as it plays: named, and with the Gain, Pitch, Tempo and
// Fades given.
func playing(c Clip, p playback) Clip {
	if p.name != "" {
		name := p.name
		c.Name = &name
	}
	c.Gain, c.Pitch, c.Tempo, c.FadeIn, c.FadeOut = p.gain, p.pitch, p.tempo, p.fadeIn, p.fadeOut
	return c
}

func TestUpdatingTrack(t *testing.T) {
	tests := []struct {
		name    string
		trackID int64
		changes TrackChanges
		want    Track
		refusal string
	}{
		{
			name:    "renamed, as UpdateTrack gives the name, trimmed",
			trackID: 1,
			changes: TrackChanges{Name: domain.Change[string]{Set: true, Value: "Lead vox"}},
			want:    Track{ID: 1, Name: "Lead vox"},
		},
		{
			name:    "its volume, mute and solo set at once",
			trackID: 1,
			changes: TrackChanges{Volume: domain.Change[float64]{Set: true, Value: -4.5},
				Muted: domain.Change[bool]{Set: true, Value: true}, Soloed: domain.Change[bool]{Set: true, Value: true}},
			want: Track{ID: 1, Name: "Beat", Volume: -4.5, Muted: true, Soloed: true},
		},
		{
			name:    "nothing set, which leaves the Track as it was",
			trackID: 1,
			changes: TrackChanges{},
			want:    Track{ID: 1, Name: "Beat"},
		},
		{
			name:    "a Track that isn't on the Timeline",
			trackID: 9,
			changes: TrackChanges{Name: domain.Change[string]{Set: true, Value: "Lead vox"}},
			refusal: "not found",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf([]Clip{beatClip(1, 0, 10)})
			tl.Tracks[0].Name = "Beat"
			after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
				return tl.updatingTrack(tt.trackID, tt.changes)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("updatingTrack error = %v", err)
			}
			got := after.Tracks[0]
			// Its Clips go with it, whatever changed.
			if len(got.Clips) != 1 {
				t.Errorf("the Track's Clips = %+v, want the one it had", got.Clips)
			}
			got.Clips = nil
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("the Track = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestAddingTrack(t *testing.T) {
	beat := int64(1)
	// The Clips already on the Timeline: two Tracks, "Beat" and "Adlibs".
	tracks := func() Timeline {
		tl := timelineOf([]Clip{beatClip(1, 0, 10)}, []Clip{})
		tl.Tracks[0].Name, tl.Tracks[1].Name = "Beat", "Adlibs"
		return tl
	}
	clip := func(start, offset, length float64) NewClip {
		return NewClip{BeatID: &beat, ClipPlayback: asRecorded(), Start: start, Offset: offset, Length: length}
	}
	tests := []struct {
		name       string
		add        NewTrack
		wantTracks []string
		want       []where
		refusal    string
	}{
		{
			name:       "an empty Track at the bottom",
			add:        NewTrack{Name: "Lead vox"},
			wantTracks: []string{"Beat", "Adlibs", "Lead vox"},
			want:       []where{{clipID: 1, trackID: 1, length: 10}},
		},
		{
			name:       "a Track added back on top with its Clips and their trims, as undo adds it",
			add:        NewTrack{Name: "Keys", Position: placeOf(0), Clips: []NewClip{clip(0, 0, 10), clip(32, 2, 15)}},
			wantTracks: []string{"Keys", "Beat", "Adlibs"},
			want: []where{{clipID: 2, trackID: 3, length: 10}, {clipID: 3, trackID: 3, start: 32, offset: 2, length: 15},
				{clipID: 1, trackID: 1, length: 10}},
		},
		{
			name:       "a Track added between the others",
			add:        NewTrack{Name: "Keys", Position: placeOf(1)},
			wantTracks: []string{"Beat", "Keys", "Adlibs"},
			want:       []where{{clipID: 1, trackID: 1, length: 10}},
		},
		{
			name:    "a Track added back with Clips over each other",
			add:     NewTrack{Name: "Keys", Clips: []NewClip{clip(0, 0, 10), clip(5, 0, 10)}},
			refusal: "Clips can't overlap on a Track",
		},
		{
			name:    "a Track added back with a Clip past its source",
			add:     NewTrack{Name: "Keys", Clips: []NewClip{clip(0, 55, 10)}},
			refusal: "a Clip can't play past the end of its source",
		},
		{
			name:    "a Track added past the bottom",
			add:     NewTrack{Name: "Keys", Position: placeOf(3)},
			refusal: "a Track's position must be from 0 to the number of Tracks",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := tracks()
			srcs := make([]clipSource, len(tt.add.Clips))
			for i := range srcs {
				srcs[i] = clipSource{beat: &Beat{ID: 1, Duration: 10}}
			}
			after, err := edited(tl, func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.addingTrack(tt.add, srcs, ids)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("addingTrack error = %v", err)
			}
			if !reflect.DeepEqual(trackNames(after), tt.wantTracks) {
				t.Errorf("the Tracks = %v, want %v", trackNames(after), tt.wantTracks)
			}
			if got := clipsIn(after); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("the Clips = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestImportingSound(t *testing.T) {
	snd := Sound{ID: 2, Name: "Hum", Duration: 8}
	tests := []struct {
		name    string
		tracks  [][]Clip
		trackID int64
		want    where
		refusal string
	}{
		{
			name:    "the whole Sound at 0:00 on an empty Track",
			tracks:  [][]Clip{{}},
			trackID: 1,
			want:    where{clipID: 1, trackID: 1, length: 8},
		},
		{
			name:    "after the Track's last Clip",
			tracks:  [][]Clip{{beatClip(1, 0, 10), beatClip(5, 20, 5)}},
			trackID: 1,
			want:    where{clipID: 6, trackID: 1, start: 25, length: 8},
		},
		{
			name:    "a Track that isn't on the Timeline",
			tracks:  [][]Clip{{}},
			trackID: 9,
			refusal: "there's no such Track on this Timeline",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf(tt.tracks...)
			after, err := edited(tl, func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.importingSound(tt.trackID, snd, ids.clip())
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("importingSound error = %v", err)
			}
			if got := clipIn(t, after, tt.want.clipID); got != tt.want {
				t.Errorf("the Sound's Clip = %+v, want %+v", got, tt.want)
			}
			// The Timeline lists the Sound its Clip now plays.
			if len(after.Sounds) != 1 || after.Sounds[0].ID != snd.ID {
				t.Errorf("the Sounds = %+v, want the Sound imported", after.Sounds)
			}
			_, c, _ := after.clip(tt.want.clipID)
			if c.SoundID == nil || *c.SoundID != snd.ID {
				t.Errorf("the Clip plays Sound %v, want %d", c.SoundID, snd.ID)
			}
			if got := playbackOf(c); got != (playback{tempo: 1}) {
				t.Errorf("the Clip plays %+v, want it as recorded", got)
			}
		})
	}
}

func TestSettingGain(t *testing.T) {
	tl := timelineOf([]Clip{beatClip(1, 0, 10), beatClip(2, 20, 10)})
	after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
		return tl.settingGain(1, 6)
	})
	if err != nil {
		t.Fatalf("settingGain error = %v", err)
	}
	_, c, _ := after.clip(1)
	if got := playbackOf(c); got != (playback{gain: 6, tempo: 1}) {
		t.Errorf("the Clip plays %+v, want it 6 dB louder and nothing else changed", got)
	}
	// Only that Clip's Gain, and nowhere it is on the Timeline.
	if _, other, _ := after.clip(2); other.Gain != 0 {
		t.Errorf("the other Clip's Gain = %g, want 0", other.Gain)
	}
	if !reflect.DeepEqual(clipsIn(after), clipsIn(tl)) {
		t.Errorf("the Clips = %+v, want them where they were: %+v", clipsIn(after), clipsIn(tl))
	}

	if _, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
		return tl.settingGain(9, 6)
	}); err == nil {
		t.Error("settingGain on a Clip that isn't on the Timeline, want it refused")
	}
}

func TestSettingPitches(t *testing.T) {
	tl := timelineOf([]Clip{beatClip(1, 0, 10)}, []Clip{beatClip(2, 20, 10)})
	tl.Tracks[0].Clips[0].FadeIn = 2
	up, down := 3.0, -5.0
	after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
		return tl.settingPitches([]ClipPitch{{ClipID: 1, Pitch: &up}, {ClipID: 2, Pitch: &down}})
	})
	if err != nil {
		t.Fatalf("settingPitches error = %v", err)
	}
	// Both in one change, and nothing but the Pitch: the Clips keep their
	// places, lengths, Tempos and Fades.
	_, first, _ := after.clip(1)
	if got := playbackOf(first); got != (playback{pitch: 3, tempo: 1, fadeIn: 2}) {
		t.Errorf("the first Clip plays %+v, want it 3 semitones up and nothing else changed", got)
	}
	if _, second, _ := after.clip(2); second.Pitch != -5 {
		t.Errorf("the second Clip's Pitch = %g, want -5", second.Pitch)
	}
	if !reflect.DeepEqual(clipsIn(after), clipsIn(tl)) {
		t.Errorf("the Clips = %+v, want them where they were: %+v", clipsIn(after), clipsIn(tl))
	}

	// If one Clip isn't on the Timeline, neither Pitch is set.
	if _, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
		return tl.settingPitches([]ClipPitch{{ClipID: 1, Pitch: &up}, {ClipID: 9, Pitch: &up}})
	}); err == nil {
		t.Error("settingPitches naming a Clip that isn't on the Timeline, want it refused")
	}
}

func TestSettingFades(t *testing.T) {
	tests := []struct {
		name    string
		fades   Fades
		want    Fades
		refusal string
	}{
		{
			name:  "a Fade at each end",
			fades: Fades{In: 2, Out: 3},
			want:  Fades{In: 2, Out: 3},
		},
		{
			name:  "Fades that meet in the middle",
			fades: Fades{In: 5, Out: 5},
			want:  Fades{In: 5, Out: 5},
		},
		{
			name:  "a Fade cleared",
			fades: Fades{In: 0, Out: 3},
			want:  Fades{Out: 3},
		},
		{
			name:    "Fades longer together than the Clip",
			fades:   Fades{In: 6, Out: 5},
			refusal: "a Clip's Fades can't together run longer than it",
		},
		{
			name:    "a Fade shorter than nothing",
			fades:   Fades{In: -1},
			refusal: "a Fade can't be shorter than nothing",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf([]Clip{beatClip(1, 0, 10)})
			after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
				return tl.settingFades(1, tt.fades)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("settingFades error = %v", err)
			}
			_, c, _ := after.clip(1)
			if got := c.fades(); got != tt.want {
				t.Errorf("the Clip's Fades = %+v, want %+v", got, tt.want)
			}
			if !reflect.DeepEqual(clipsIn(after), clipsIn(tl)) {
				t.Errorf("the Clips = %+v, want them where they were: %+v", clipsIn(after), clipsIn(tl))
			}
		})
	}
}

func TestSettingFadesOfAClipThatIsntOnTheTimeline(t *testing.T) {
	tl := timelineOf([]Clip{beatClip(1, 0, 10)})
	_, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
		return tl.settingFades(9, Fades{In: 1})
	})
	refused(t, err, "not found")
}

func TestKeepingActiveTake(t *testing.T) {
	// A Clip of three Takes, playing the second, its window out to the end
	// of the last.
	clip := takesClip(1, 10, 0, 25, Take{ID: 7, Number: 1}, Take{ID: 8, Number: 2, Position: 5},
		Take{ID: 9, Number: 3, Position: 15})
	clip.ActiveTakeID = idOf(8)
	tl := timelineOf([]Clip{clip})

	after, err := edited(tl, func(tl Timeline, _ *ids) (Timeline, error) {
		return tl.keepingActiveTake(1)
	})
	if err != nil {
		t.Fatalf("keepingActiveTake error = %v", err)
	}
	_, c, _ := after.clip(1)
	if want := []int64{8}; !reflect.DeepEqual(takeIDsIn(c), want) {
		t.Errorf("the Clip's Takes = %v, want only the one it plays: %v", takeIDsIn(c), want)
	}
	// Its window shrinks to where the Take kept ends, 0:15 in the span.
	if want := (where{clipID: 1, trackID: 1, start: 10, length: 15}); clipIn(t, after, 1) != want {
		t.Errorf("the Clip = %+v, want %+v", clipIn(t, after, 1), want)
	}

	_, err = edited(timelineOf([]Clip{beatClip(1, 0, 10)}), func(tl Timeline, _ *ids) (Timeline, error) {
		return tl.keepingActiveTake(1)
	})
	refused(t, err, "only a Clip of Takes has Takes")
}

func TestReplacingClips(t *testing.T) {
	beat := int64(1)
	// Two Clips on the top Track, and one on a Track below, as a Merge of
	// the two leaves them: the merged Clip on the Track it added.
	tracks := [][]Clip{{beatClip(1, 0, 10)}, {beatClip(2, 20, 10)}}
	back := func(on OnTrack, clipID int64, start float64) PlacedClip {
		return PlacedClip{OnTrack: on,
			NewClip: NewClip{BeatID: &beat, ClipPlayback: asRecorded(), Start: start, Length: 10}}
	}
	tests := []struct {
		name       string
		clipIDs    []int64
		trackIDs   []int64
		newTracks  []TrackAt
		clips      []PlacedClip
		wantTracks []string
		want       []where
		refusal    string
	}{
		{
			name:       "a Merge undone: its Clip and the Track it added out, the Clips merged back",
			clipIDs:    []int64{2},
			trackIDs:   []int64{2},
			clips:      []PlacedClip{back(OnTrack{TrackID: 1}, 0, 20)},
			wantTracks: []string{""},
			want:       []where{{clipID: 1, trackID: 1, length: 10}, {clipID: 3, trackID: 1, start: 20, length: 10}},
		},
		{
			name:       "a Merge redone: the Clips merged out, its Clip on a Track added back where it was",
			clipIDs:    []int64{1},
			newTracks:  []TrackAt{{Name: "Track 3", Position: 1}},
			clips:      []PlacedClip{back(OnTrack{NewTrack: placeOf(0)}, 0, 0)},
			wantTracks: []string{"", "Track 3", ""},
			want:       []where{{clipID: 3, trackID: 3, length: 10}, {clipID: 2, trackID: 2, start: 20, length: 10}},
		},
		{
			name:    "a Clip put back over one left where it was",
			clipIDs: []int64{1},
			clips:   []PlacedClip{back(OnTrack{TrackID: 2}, 0, 25)},
			refusal: "Clips can't overlap on a Track",
		},
		{
			name:    "a Clip put back on a new Track that wasn't added",
			clipIDs: []int64{1},
			clips:   []PlacedClip{back(OnTrack{NewTrack: placeOf(0)}, 0, 0)},
			refusal: "there's no such new Track",
		},
		{
			name:    "a Clip that isn't on the Timeline",
			clipIDs: []int64{9},
			clips:   []PlacedClip{back(OnTrack{TrackID: 1}, 0, 20)},
			refusal: "not found",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf(tracks...)
			srcs := make([]clipSource, len(tt.clips))
			for i := range srcs {
				srcs[i] = clipSource{beat: &Beat{ID: 1, Duration: 60}}
			}
			after, err := edited(tl, func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.replacingClips(tt.clipIDs, tt.trackIDs, tt.newTracks, tt.clips, srcs, ids)
			})
			if tt.refusal != "" {
				refused(t, err, tt.refusal)
				return
			}
			if err != nil {
				t.Fatalf("replacingClips error = %v", err)
			}
			if !reflect.DeepEqual(trackNames(after), tt.wantTracks) {
				t.Errorf("the Tracks = %v, want %v", trackNames(after), tt.wantTracks)
			}
			if got := clipsIn(after); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("the Clips = %+v, want %+v", got, tt.want)
			}
		})
	}
}

// How a Clip plays is the Clip's, not a placement: an edit that copies,
// places or cuts a Clip carries it, and a Merge's Clip starts with none of
// it. These were only ever checked through the HTTP server.
func TestEditsCarryHowAClipPlays(t *testing.T) {
	beat := int64(1)
	how := playback{name: "Chorus", gain: 6, pitch: -3, tempo: 1, fadeIn: 2, fadeOut: 3}
	// The Clip the edits start from: 0:00 to 0:10, playing as how says.
	played := playing(beatClip(1, 0, 10), how)
	src := clipSource{beat: &Beat{ID: 1, Duration: 60}}

	tests := []struct {
		name string
		clip Clip
		// of is the Clip to read how it plays off once the edit is made.
		of   int64
		edit edit
		want playback
	}{
		{
			name: "a Duplicate copies it",
			clip: played,
			of:   3,
			edit: func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.duplicating(1, ids.clip(), []Take{}, nil)
			},
			want: how,
		},
		{
			name: "a Clip placed back plays as it's given",
			clip: beatClip(1, 0, 10),
			of:   3,
			edit: func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.placingNew(1, NewClip{BeatID: &beat, Name: &how.name,
					ClipPlayback: ClipPlayback{Gain: how.gain, Pitch: how.pitch, Tempo: how.tempo,
						FadeIn: how.fadeIn, FadeOut: how.fadeOut},
					Start: 40, Length: 10}, src, ids.clip())
			},
			want: how,
		},
		{
			name: "a Clip pasted plays as it was copied",
			clip: beatClip(1, 0, 10),
			of:   3,
			edit: func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.pasting(nil, []ClipCopy{{OnTrack: OnTrack{TrackID: 1}, BeatID: &beat, Name: &how.name,
					ClipPlayback: ClipPlayback{Gain: how.gain, Pitch: how.pitch, Tempo: how.tempo,
						FadeIn: how.fadeIn, FadeOut: how.fadeOut},
					Start: 40, Length: 10}}, []clipSource{src}, ids)
			},
			want: how,
		},
		{
			name: "the left half of a Split keeps it, its fade in shortened to the cut",
			clip: played,
			of:   1,
			edit: func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.splitting(1, 1.5, ids.clip(), splitTakes{})
			},
			want: playback{name: "Chorus", gain: 6, pitch: -3, tempo: 1, fadeIn: 1.5},
		},
		{
			name: "the right half of a Split keeps it, with the fade out",
			clip: played,
			of:   3,
			edit: func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.splitting(1, 4, ids.clip(), splitTakes{})
			},
			want: playback{name: "Chorus", gain: 6, pitch: -3, tempo: 1, fadeOut: 3},
		},
		{
			name: "the right half of a Split has its fade out shortened to fit",
			clip: played,
			of:   3,
			edit: func(tl Timeline, ids *ids) (Timeline, error) {
				return tl.splitting(1, 8, ids.clip(), splitTakes{})
			},
			want: playback{name: "Chorus", gain: 6, pitch: -3, tempo: 1, fadeOut: 2},
		},
		{
			name: "a Merge's Clip starts with none of it",
			clip: played,
			of:   3,
			edit: func(tl Timeline, ids *ids) (Timeline, error) {
				landing := int64(1)
				return tl.merging(ClipMerge{ClipIDs: []int64{1, 2}, TrackID: &landing},
					Sound{ID: 2, Name: MergedName, Duration: 30}, 48000, ids)
			},
			want: playback{tempo: 1},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf([]Clip{tt.clip, beatClip(2, 20, 10)})
			after, err := edited(tl, tt.edit)
			if err != nil {
				t.Fatalf("the edit's error = %v", err)
			}
			_, c, ok := after.clip(tt.of)
			if !ok {
				t.Fatalf("clip %d isn't on the Timeline", tt.of)
			}
			if got := playbackOf(c); got != tt.want {
				t.Errorf("the Clip plays %+v, want %+v", got, tt.want)
			}
		})
	}
}

// A Retake grows its Clip's window; the Clip's name, Gain and Fades are
// none of its business.
func TestARetakeKeepsHowItsClipPlays(t *testing.T) {
	how := playback{name: "Chorus", gain: -9, tempo: 1, fadeIn: 2, fadeOut: 3}
	clip := playing(takesClip(1, 10, 0, 10, Take{ID: 7, Number: 1}), how)
	after, err := edited(timelineOf([]Clip{clip}), func(tl Timeline, _ *ids) (Timeline, error) {
		return tl.retaking(1, Take{ID: 8, Number: 2, Duration: 20}, 10)
	})
	if err != nil {
		t.Fatalf("retaking error = %v", err)
	}
	_, c, _ := after.clip(1)
	if got := playbackOf(c); got != how {
		t.Errorf("the Clip plays %+v, want %+v", got, how)
	}
	// Its window grew to the Retake's end, the Fades staying as they were.
	if want := (where{clipID: 1, trackID: 1, start: 10, length: 20}); clipIn(t, after, 1) != want {
		t.Errorf("the Clip = %+v, want %+v", clipIn(t, after, 1), want)
	}
}

// A Clip keeps how it plays through the edits that move it about, which say
// nothing about it.
func TestMovingAClipKeepsHowItPlays(t *testing.T) {
	how := playback{name: "Chorus", gain: 6, pitch: -3, tempo: 1, fadeIn: 2, fadeOut: 3}
	tests := []struct {
		name string
		edit edit
	}{
		{
			name: "moved along its Track",
			edit: func(tl Timeline, _ *ids) (Timeline, error) { return tl.moving(1, 1, 30) },
		},
		{
			name: "trimmed to a length its Fades still fit",
			edit: func(tl Timeline, _ *ids) (Timeline, error) { return tl.trimming(1, 2, 8, nil) },
		},
		{
			name: "renamed, which changes only its name",
			edit: func(tl Timeline, _ *ids) (Timeline, error) { return tl.renaming(1, "Verse") },
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tl := timelineOf([]Clip{playing(beatClip(1, 0, 10), how)})
			after, err := edited(tl, tt.edit)
			if err != nil {
				t.Fatalf("the edit's error = %v", err)
			}
			_, c, _ := after.clip(1)
			want := how
			if tt.name == "renamed, which changes only its name" {
				want.name = "Verse"
			}
			if got := playbackOf(c); got != want {
				t.Errorf("the Clip plays %+v, want %+v", got, want)
			}
		})
	}
}
