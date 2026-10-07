// Package songfiles defines the kinds of files a Song has, in one place, so
// deleting a Song, its Backup and its Restore all cover the same files. A
// Song owns its Masters, its Cover's pictures, its Takes and its Sounds,
// which go when it does. It uses Beats, which are the Beat Library's but
// travel in its Backup.
//
// Each file is kept under the id of the row it belongs to, in its kind's
// directory under the data directory. This package only names them: the
// stores keeping them live with the code using them.
package songfiles

// Kind is a kind of file a Song has.
type Kind struct {
	// Dir is the directory, slash-separated and relative to the data
	// directory, such files are kept in.
	Dir string
	// Table holds the rows such files are kept under, each by its row's id.
	Table string
	// IDs lists the ids of a Song's files of this kind, given the Song's id
	// as ?1, from the database attached as main.
	IDs string
	// Owned is whether the Song owns such files, so they go when it does,
	// rather than only using them.
	Owned bool
}

// A Cover's pictures, each kept in a directory of its own.
const (
	CoverOriginal = "original"
	// CoverList is the crop square at the Song list's size.
	CoverList = "list"
	// CoverHeader is the crop square at the Song page header's size.
	CoverHeader = "header"
)

// CoverPictures lists a Cover's pictures.
var CoverPictures = []string{CoverOriginal, CoverList, CoverHeader}

var (
	Beats = Kind{Dir: "audio/beats", Table: "beats", IDs: `SELECT DISTINCT c.beat_id FROM main.clips c
		JOIN main.tracks t ON t.id = c.track_id WHERE t.song_id = ?1 AND c.beat_id IS NOT NULL`}
	Masters = Kind{Dir: "audio/masters", Table: "masters", Owned: true,
		IDs: `SELECT id FROM main.masters WHERE song_id = ?1`}
	// Takes and Sounds include those kept only for undo: detached Takes and
	// Sounds no Clip uses.
	Takes = Kind{Dir: "audio/takes", Table: "takes", Owned: true,
		IDs: `SELECT id FROM main.takes WHERE song_id = ?1`}
	Sounds = Kind{Dir: "audio/sounds", Table: "sounds", Owned: true,
		IDs: `SELECT id FROM main.sounds WHERE song_id = ?1`}
)

// Cover is the kind of a Cover's picture, one of CoverPictures.
func Cover(picture string) Kind {
	return Kind{Dir: "covers/" + picture, Table: "covers", Owned: true,
		IDs: `SELECT id FROM main.covers WHERE song_id = ?1`}
}

// Kinds lists every kind of file a Song has, owned or used.
var Kinds = func() []Kind {
	kinds := []Kind{Beats, Masters, Takes, Sounds}
	for _, p := range CoverPictures {
		kinds = append(kinds, Cover(p))
	}
	return kinds
}()

// Owned lists the kinds of file a Song owns.
func Owned() []Kind {
	var owned []Kind
	for _, k := range Kinds {
		if k.Owned {
			owned = append(owned, k)
		}
	}
	return owned
}
