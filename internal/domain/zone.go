package domain

import (
	"context"
	"time"
	// The zone database is built in, so a time zone is known whatever the
	// image or host holds.
	_ "time/tzdata"
)

type zoneKey struct{}

// ParseZone reads a time zone by its name, e.g. "Europe/Lisbon", as the
// browser names its own. An empty, unknown or "Local" name is UTC, so the
// server's own zone never stands in for the user's.
func ParseZone(name string) *time.Location {
	if name == "" || name == "Local" {
		return time.UTC
	}
	zone, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return zone
}

// WithZone is ctx carrying the time zone of the Device a request came from.
func WithZone(ctx context.Context, zone *time.Location) context.Context {
	return context.WithValue(ctx, zoneKey{}, zone)
}

// Zone is the time zone WithZone gave ctx, or UTC if none: the zone a day
// or a time is the user's in.
func Zone(ctx context.Context) *time.Location {
	if zone, ok := ctx.Value(zoneKey{}).(*time.Location); ok {
		return zone
	}
	return time.UTC
}
