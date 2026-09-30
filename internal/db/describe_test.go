package db

import (
	"context"
	"regexp"
	"testing"
	"time"
)

func TestTheSchemaIsNamedByTheLatestAppliedMigration(t *testing.T) {
	before := time.Now().UTC().Truncate(time.Millisecond)
	conn := openBefore(t, "0027_track_volume_range")
	after := time.Now().UTC()

	d, err := Describe(context.Background(), conn)
	if err != nil {
		t.Fatalf("Describe: %v", err)
	}
	if d.Schema.Migration != "0026_no_last_take_number" {
		t.Errorf("schema = %q, want 0026_no_last_take_number", d.Schema.Migration)
	}
	if d.Schema.AppliedAt.Before(before) || d.Schema.AppliedAt.After(after) {
		t.Errorf("applied at %v, want between %v and %v", d.Schema.AppliedAt, before, after)
	}
}

func TestTheSQLiteVersionIsTheEnginesOwn(t *testing.T) {
	d, err := Describe(context.Background(), openBefore(t, ""))
	if err != nil {
		t.Fatalf("Describe: %v", err)
	}
	if !regexp.MustCompile(`^3\.\d+\.\d+$`).MatchString(d.SQLiteVersion) {
		t.Errorf("SQLite version = %q, want 3.x.y", d.SQLiteVersion)
	}
}
