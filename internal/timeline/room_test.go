package timeline

import (
	"slices"
	"testing"
)

func TestTrackEnd(t *testing.T) {
	tests := []struct {
		name  string
		track Track
		want  float64
	}{
		{name: "an empty Track", track: Track{}, want: 0},
		{name: "a Track whose last Clip ends last", track: Track{Clips: []Clip{beatClip(1, 0, 4), beatClip(2, 10, 4)}}, want: 14},
		{name: "a long Clip ending after a later one", track: Track{Clips: []Clip{beatClip(1, 0, 30), beatClip(2, 10, 4)}}, want: 30},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := trackEnd(tt.track); got != tt.want {
				t.Errorf("trackEnd = %g, want %g", got, tt.want)
			}
		})
	}
}

func TestDuplicateStart(t *testing.T) {
	tests := []struct {
		name  string
		clips []Clip
		want  float64
	}{
		{
			name:  "room right after it",
			clips: []Clip{beatClip(1, 0, 4)},
			want:  4,
		},
		{
			name:  "a neighbour that the copy just touches",
			clips: []Clip{beatClip(1, 0, 4), beatClip(2, 8, 4)},
			want:  4,
		},
		{
			name:  "a neighbour a rounding hair into the copy's place",
			clips: []Clip{beatClip(1, 0, 4), beatClip(2, 8-tolerance/2, 4)},
			want:  4,
		},
		{
			name:  "a neighbour in the way, skipped past to the Track's end",
			clips: []Clip{beatClip(1, 0, 4), beatClip(2, 6, 4), beatClip(3, 20, 4)},
			want:  24,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			track := Track{ID: 1, Clips: tt.clips}
			if got := duplicateStart(track, tt.clips[0]); got != tt.want {
				t.Errorf("duplicateStart = %g, want %g", got, tt.want)
			}
		})
	}
}

func TestTempoMoves(t *testing.T) {
	tests := []struct {
		name   string
		tl     Timeline
		tempos []ClipTempo
		want   []tempoMove
	}{
		{
			name:   "a Clip slowed into the next moves below its Track",
			tl:     timelineOf([]Clip{beatClip(1, 0, 10), beatClip(2, 15, 10)}),
			tempos: []ClipTempo{{1, 0.5}},
			want:   []tempoMove{{clipID: 1, from: 1, newTrack: 0}},
		},
		{
			name:   "a Clip slowed with room before the next stays",
			tl:     timelineOf([]Clip{beatClip(1, 0, 10), beatClip(2, 30, 10)}),
			tempos: []ClipTempo{{1, 0.5}},
		},
		{
			name:   "a Clip slowed to just touch the next stays",
			tl:     timelineOf([]Clip{beatClip(1, 0, 10), beatClip(2, 20, 10)}),
			tempos: []ClipTempo{{1, 0.5}},
		},
		{
			name:   "the last Clip on a Track, slowed, stays",
			tl:     timelineOf([]Clip{beatClip(1, 0, 10), beatClip(2, 10, 10)}),
			tempos: []ClipTempo{{2, 0.5}},
		},
		{
			name:   "Clips sped up always fit",
			tl:     timelineOf([]Clip{beatClip(1, 0, 10), beatClip(2, 10, 10), beatClip(3, 20, 10)}),
			tempos: []ClipTempo{{1, 2}, {2, 1.5}, {3, 2}},
		},
		{
			name:   "slowed Clips from one Track share a new Track where they fit",
			tl:     timelineOf([]Clip{beatClip(1, 0, 10), beatClip(2, 11, 10), beatClip(3, 30, 10), beatClip(4, 41, 10)}),
			tempos: []ClipTempo{{1, 0.5}, {3, 0.5}},
			want:   []tempoMove{{clipID: 1, from: 1, newTrack: 0}, {clipID: 3, from: 1, newTrack: 0}},
		},
		{
			name: "slowed Clips that don't fit together get a new Track each",
			tl: timelineOf([]Clip{
				beatClip(1, 0, 10), beatClip(2, 10, 2), beatClip(3, 12, 10), beatClip(4, 22, 10),
			}),
			tempos: []ClipTempo{{3, 0.5}, {1, 0.5}},
			want:   []tempoMove{{clipID: 1, from: 1, newTrack: 0}, {clipID: 3, from: 1, newTrack: 1}},
		},
		{
			name:   "a slowed Clip fits in the room left by the next moving away",
			tl:     timelineOf([]Clip{beatClip(1, 0, 10), beatClip(2, 10, 10), beatClip(3, 20, 10)}),
			tempos: []ClipTempo{{1, 0.5}, {2, 0.5}},
			want:   []tempoMove{{clipID: 2, from: 1, newTrack: 0}},
		},
		{
			name:   "slowed Clips from different Tracks each move below their own",
			tl:     timelineOf([]Clip{beatClip(1, 0, 10), beatClip(2, 15, 10)}, []Clip{beatClip(3, 0, 10), beatClip(4, 15, 10)}),
			tempos: []ClipTempo{{3, 0.5}, {1, 0.5}},
			want:   []tempoMove{{clipID: 1, from: 1, newTrack: 0}, {clipID: 3, from: 2, newTrack: 0}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tempoMoves(tt.tl, tt.tempos); !slices.Equal(got, tt.want) {
				t.Errorf("tempoMoves = %+v, want %+v", got, tt.want)
			}
		})
	}
}
