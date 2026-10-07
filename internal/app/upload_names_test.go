package app_test

import "testing"

// Sounds and Masters name an upload from its file name by one rule, each
// with its own default.
func TestAnUploadIsNamedFromItsFileName(t *testing.T) {
	tests := map[string]struct {
		fileName, given string
		sound, master   string
	}{
		"the name it's given, trimmed":       {"hum.m4a", "  Hum idea ", "Hum idea", "Hum idea"},
		"else its file name, less extension": {"guitar line.take2.wav", "", "guitar line.take2", "guitar line.take2"},
		"a blank given name is no name":      {" hum .m4a", "   ", "hum", "hum"},
		"else its whole file name":           {".m4a", "", ".m4a", ".m4a"},
		"else the default":                   {"   ", "", "Sound", "Master"},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			ts := newTestServer(t)
			s, tl := songWithVocalTrack(t, ts)

			got := timelineChange(t, ts.importSound(s.ID, soundFile(tc.fileName, tc.given, tl.Tracks[0].ID, 3)))
			if len(got.Sounds) != 1 || got.Sounds[0].Name != tc.sound {
				t.Errorf("sounds = %+v, want one named %q", got.Sounds, tc.sound)
			}

			song := ts.uploadMaster(s.ID, fakeAudio(tc.fileName).with(map[string]any{"name": tc.given}))
			if len(song.Masters) != 1 || song.Masters[0].Name != tc.master {
				t.Errorf("masters = %+v, want one named %q", song.Masters, tc.master)
			}
		})
	}
}
