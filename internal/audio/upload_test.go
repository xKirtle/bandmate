package audio_test

import (
	"testing"

	"github.com/xKirtle/bandmate/internal/audio"
)

func TestAnUploadIsNamedFromItsFileName(t *testing.T) {
	tests := map[string]struct {
		fileName, given, want string
	}{
		"the name it's given, trimmed":       {"hum.m4a", "  Hum idea ", "Hum idea"},
		"else its file name, less extension": {"guitar line.take2.wav", "", "guitar line.take2"},
		"a blank given name is no name":      {" hum .m4a", "   ", "hum"},
		"else its whole file name":           {".m4a", "", ".m4a"},
		"else the default":                   {"", "", "Sound"},
		"a blank file name is no name":       {"   ", "", "Sound"},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			u := audio.Upload{FileName: tc.fileName}
			if got := u.Name(tc.given, "Sound"); got != tc.want {
				t.Errorf("Name(%q, %q) of %q = %q, want %q", tc.given, "Sound", tc.fileName, got, tc.want)
			}
		})
	}
}
