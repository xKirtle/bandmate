package app_test

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"github.com/xKirtle/bandmate/internal/songfiles"
)

// filesKept lists the files kept in dataDir of each kind a Song has, by
// the kind's directory.
func filesKept(t *testing.T, dataDir string) map[string][]string {
	t.Helper()
	kept := map[string][]string{}
	for _, k := range songfiles.Kinds {
		entries, err := os.ReadDir(filepath.Join(dataDir, filepath.FromSlash(k.Dir)))
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			t.Fatalf("reading %s: %v", k.Dir, err)
		}
		for _, e := range entries {
			kept[k.Dir] = append(kept[k.Dir], e.Name())
		}
	}
	return kept
}

// Every kind of file a Song has is checked, so a new kind is covered here
// once it's listed, and once fullSong makes one.
func TestASongsBackupHoldsEveryFileItHasAndReplacingOrDeletingItRemovesThoseItOwns(t *testing.T) {
	ts := newTestServer(t)
	used := ts.beatOfLength("Used", 20)
	s := ts.fullSong(t, used.ID)
	before := filesKept(t, ts.DataDir)
	for _, k := range songfiles.Kinds {
		if len(before[k.Dir]) == 0 {
			t.Fatalf("the Song has no file in %s, want one of every kind", k.Dir)
		}
	}

	made := ts.backUp(map[string]any{"songs": []int64{s.ID}})
	if held := filesKept(t, openBackupDir(t, ts.downloadBackup(made.ID).Body)); !reflect.DeepEqual(held, before) {
		t.Errorf("files in the backup = %q, want every one the Song has, %q", held, before)
	}

	restored := ts.restoreReplacing(made.ID, []int64{s.ID}, []int64{s.ID}, nil)
	if len(restored) != 1 || restored[0].ID != s.ID {
		t.Fatalf("restored = %+v, want the Song in its place", restored)
	}
	after := filesKept(t, ts.DataDir)
	for _, k := range songfiles.Kinds {
		for _, name := range before[k.Dir] {
			if kept := slices.Contains(after[k.Dir], name); kept != !k.Owned {
				t.Errorf("%s/%s kept after replacing = %t, want %t", k.Dir, name, kept, !k.Owned)
			}
		}
		if k.Owned && len(after[k.Dir]) != len(before[k.Dir]) {
			t.Errorf("files in %s after replacing = %q, want only the %d restored", k.Dir, after[k.Dir], len(before[k.Dir]))
		}
	}

	expectStatus(t, ts.Do(http.MethodDelete, songPath(s.ID), nil), http.StatusNoContent)
	gone := filesKept(t, ts.DataDir)
	for _, k := range songfiles.Kinds {
		if k.Owned && len(gone[k.Dir]) != 0 {
			t.Errorf("files in %s after deleting = %q, want none", k.Dir, gone[k.Dir])
		}
		if !k.Owned && !reflect.DeepEqual(gone[k.Dir], after[k.Dir]) {
			t.Errorf("files in %s after deleting = %q, want them kept, %q", k.Dir, gone[k.Dir], after[k.Dir])
		}
	}
}
