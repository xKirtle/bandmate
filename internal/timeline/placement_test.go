package timeline

import "testing"

// where is where a Clip ends up: the Track it's on, where it starts, what
// of its source it plays and for how long, as a placement holds them.
type where struct {
	trackID               int64
	start, offset, length float64
}

// errMessage is err's message, or "" for no error.
func errMessage(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// placedAt is where p puts its Clip.
func placedAt(p placement) where {
	return where{trackID: p.trackID, start: p.start, offset: p.offset, length: p.length}
}

func TestMoved(t *testing.T) {
	tl := timelineOf(
		[]Clip{beatClip(1, 0, 10), beatClip(2, 30, 10)},
		[]Clip{beatClip(3, 0, 10)},
	)
	tests := []struct {
		name    string
		clipID  int64
		trackID int64
		start   float64
		want    where
		wantErr string
	}{
		{
			name: "a Clip moved against the next Clip on its Track",
			// It ends exactly where Clip 2 starts.
			clipID: 1, trackID: 1, start: 20,
			want: where{trackID: 1, start: 20, length: 10},
		},
		{
			name:   "a Clip moved onto another Track, keeping its trim",
			clipID: 2, trackID: 2, start: 15,
			want: where{trackID: 2, start: 15, length: 10},
		},
		{
			name:   "a Clip that isn't on the Timeline",
			clipID: 9, trackID: 1, start: 0,
			wantErr: "not found",
		},
		{
			name:   "a Track that isn't on the Timeline",
			clipID: 1, trackID: 9, start: 0,
			wantErr: "there's no such Track on this Timeline",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, err := tl.moved(tt.clipID, tt.trackID, tt.start)
			if err != nil || tt.wantErr != "" {
				if got := errMessage(err); got != tt.wantErr {
					t.Fatalf("moved error = %q, want %q", got, tt.wantErr)
				}
				return
			}
			if got := placedAt(p); got != tt.want {
				t.Errorf("moved = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestTrimmed(t *testing.T) {
	slowed := beatClip(2, 100, 20)
	slowed.Tempo = 0.5
	tl := timelineOf([]Clip{beatClip(1, 10, 20), slowed})
	tests := []struct {
		name           string
		clipID         int64
		offset, length float64
		want           where
		wantErr        string
	}{
		{
			name: "trimmed at its start, which moves where it starts",
			// It plays its source from 0:05, so it starts 5 seconds later.
			clipID: 1, offset: 5, length: 15,
			want: where{trackID: 1, start: 15, offset: 5, length: 15},
		},
		{
			name:   "trimmed at its end, which leaves its start alone",
			clipID: 1, offset: 0, length: 12,
			want: where{trackID: 1, start: 10, offset: 0, length: 12},
		},
		{
			name:   "trimmed at both ends",
			clipID: 1, offset: 4, length: 10,
			want: where{trackID: 1, start: 14, offset: 4, length: 10},
		},
		{
			name:   "trimmed back to a hair before its source's start",
			clipID: 1, offset: -tolerance / 2, length: 20,
			want: where{trackID: 1, start: 10, offset: 0, length: 20},
		},
		{
			name: "a slowed Clip trimmed at its start",
			// At half speed, 5 seconds of its source take 10 of the
			// Timeline.
			clipID: 2, offset: 5, length: 10,
			want: where{trackID: 1, start: 110, offset: 5, length: 10},
		},
		{
			name:   "a Clip that isn't on the Timeline",
			clipID: 9, offset: 0, length: 1,
			wantErr: "not found",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, err := tl.trimmed(tt.clipID, tt.offset, tt.length)
			if err != nil || tt.wantErr != "" {
				if got := errMessage(err); got != tt.wantErr {
					t.Fatalf("trimmed error = %q, want %q", got, tt.wantErr)
				}
				return
			}
			if got := placedAt(p); got != tt.want {
				t.Errorf("trimmed = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestMergedSpan(t *testing.T) {
	tl := timelineOf(
		[]Clip{beatClip(1, 10, 5), beatClip(2, 30, 5)},
		[]Clip{beatClip(3, 0, 4), beatClip(4, 50, 30)},
	)
	tests := []struct {
		name        string
		clipIDs     []int64
		start, end  float64
		wantErr     string
		wantNoClips bool
	}{
		{
			name:    "two Clips on one Track",
			clipIDs: []int64{1, 2},
			start:   10, end: 35,
		},
		{
			name:    "two Clips on different Tracks",
			clipIDs: []int64{2, 3},
			start:   0, end: 35,
		},
		{
			name:    "three Clips, the latest given first",
			clipIDs: []int64{4, 1, 3},
			start:   0, end: 80,
		},
		{
			name:    "a Clip that isn't on the Timeline",
			clipIDs: []int64{1, 9},
			wantErr: "not found",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			start, end, err := mergedSpan(tl, tt.clipIDs)
			if err != nil || tt.wantErr != "" {
				if got := errMessage(err); got != tt.wantErr {
					t.Fatalf("mergedSpan error = %q, want %q", got, tt.wantErr)
				}
				return
			}
			if start != tt.start || end != tt.end {
				t.Errorf("mergedSpan = %g to %g, want %g to %g", start, end, tt.start, tt.end)
			}
		})
	}
}
