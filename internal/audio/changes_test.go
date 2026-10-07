package audio

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// These tests go through the type directly rather than the HTTP API, which
// can't make a commit fail.

// filesIn maps the name of each file in dir to what it holds.
func filesIn(t *testing.T, dir string) map[string]string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, e := range entries {
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		got[e.Name()] = string(b)
	}
	return got
}

func TestFileChanges(t *testing.T) {
	failed := errors.New("commit failed")
	tests := []struct {
		name string
		// change makes changes to files holding "1" under 1 and "2" under 2,
		// with "new" received.
		change func(c *FileChanges, files *Files, received *Received)
		// commit is the transaction's commit, or nil if it rolls back.
		commit func() error
		want   map[string]string
	}{
		{
			name:   "keep, committed",
			change: func(c *FileChanges, _ *Files, r *Received) { c.Keep(r, 3) },
			commit: func() error { return nil },
			want:   map[string]string{"1": "1", "2": "2", "3": "new"},
		},
		{
			name:   "keep over a file, committed",
			change: func(c *FileChanges, _ *Files, r *Received) { c.Keep(r, 2) },
			commit: func() error { return nil },
			want:   map[string]string{"1": "1", "2": "new"},
		},
		{
			name:   "link, committed",
			change: func(c *FileChanges, f *Files, _ *Received) { c.Link(f, 1, 3) },
			commit: func() error { return nil },
			want:   map[string]string{"1": "1", "2": "2", "3": "1"},
		},
		{
			name:   "remove, committed",
			change: func(c *FileChanges, f *Files, _ *Received) { c.Remove(f, 1) },
			commit: func() error { return nil },
			want:   map[string]string{"2": "2"},
		},
		{
			name: "link then remove the file linked, committed",
			change: func(c *FileChanges, f *Files, _ *Received) {
				c.Link(f, 1, 3)
				c.Remove(f, 1)
			},
			commit: func() error { return nil },
			want:   map[string]string{"2": "2", "3": "1"},
		},
		{
			name: "every change, failed commit",
			change: func(c *FileChanges, f *Files, r *Received) {
				c.Keep(r, 3)
				c.Link(f, 1, 4)
				c.Remove(f, 2)
			},
			commit: func() error { return failed },
			want:   map[string]string{"1": "1", "2": "2"},
		},
		{
			name: "every change, rolled back",
			change: func(c *FileChanges, f *Files, r *Received) {
				c.Keep(r, 3)
				c.Link(f, 1, 4)
				c.Remove(f, 2)
			},
			want: map[string]string{"1": "1", "2": "2"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			files, err := Open(dir)
			if err != nil {
				t.Fatal(err)
			}
			for _, id := range []string{"1", "2"} {
				if err := os.WriteFile(filepath.Join(dir, id), []byte(id), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			received, err := files.Receive(strings.NewReader("new"), 100)
			if err != nil {
				t.Fatal(err)
			}
			var c FileChanges
			tt.change(&c, files, received)
			if tt.commit != nil {
				if err := c.Commit(tt.commit); !errors.Is(err, tt.commit()) {
					t.Fatalf("Commit = %v, want %v", err, tt.commit())
				}
			}
			// As whoever received it does, kept or not.
			received.Discard()
			if got := filesIn(t, dir); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("files = %q, want %q", got, tt.want)
			}
		})
	}
}
