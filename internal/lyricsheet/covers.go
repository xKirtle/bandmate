package lyricsheet

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"mime"
	"net/http"
	"time"

	"github.com/xKirtle/bandmate/internal/audio"
)

// Cover is a Song's picture, shown as a square chosen from it. The browser
// makes the pictures: the original, normalized so any browser can open it,
// and the crop square in the list and header sizes. The server keeps them
// as uploaded and never decodes them.
type Cover struct {
	ID int64 `json:"id"`
	// Width and Height are the original's, in pixels.
	Width  int `json:"width"`
	Height int `json:"height"`
	// Crop is the square of the original the Cover shows.
	Crop    CoverCrop `json:"crop"`
	AddedAt time.Time `json:"addedAt"`
}

// CoverCrop is a square of a Cover's original, in its pixels.
type CoverCrop struct {
	X    int `json:"x"`
	Y    int `json:"y"`
	Size int `json:"size"`
}

// CoverDetails are what the browser worked out about a Cover's original
// and the square it cropped.
type CoverDetails struct {
	Width  int       `json:"width"`
	Height int       `json:"height"`
	Crop   CoverCrop `json:"crop"`
}

// MaxCoverSide is the most pixels on each side of a Cover's original: the
// browser scales larger pictures down.
const MaxCoverSide = 2048

// problem says what's wrong with the details, in words safe to show the
// user, or "" if nothing is.
func (d CoverDetails) problem() string {
	if d.Width < 1 || d.Height < 1 || d.Width > MaxCoverSide || d.Height > MaxCoverSide {
		return fmt.Sprintf("the original must be between 1 and %d pixels on each side", MaxCoverSide)
	}
	c := d.Crop
	if c.Size < 1 || c.X < 0 || c.Y < 0 || c.X+c.Size > d.Width || c.Y+c.Size > d.Height {
		return "the crop must be a square inside the original"
	}
	return ""
}

// CoverPicture names one of a Cover's pictures.
type CoverPicture string

const (
	CoverOriginal CoverPicture = "original"
	// CoverList is the crop square at the Song list's size.
	CoverList CoverPicture = "list"
	// CoverHeader is the crop square at the Song page header's size.
	CoverHeader CoverPicture = "header"
)

// CoverPictures lists a Cover's pictures.
var CoverPictures = []CoverPicture{CoverOriginal, CoverList, CoverHeader}

// SquarePictures lists the pictures made from a Cover's crop square.
var SquarePictures = []CoverPicture{CoverList, CoverHeader}

// CoverFiles is where Covers' pictures are kept: one directory for each
// picture, each file named by its Cover's id.
type CoverFiles map[CoverPicture]*audio.Files

// UploadedPicture is a picture as uploaded, stored under a temporary name.
type UploadedPicture struct {
	File *audio.Received
	// ContentType is the type the upload declared.
	ContentType string
}

// pictureTypes are the picture formats a Cover is kept in: what browsers
// encode to, and nothing a browser could treat as a page.
var pictureTypes = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}

// AddCover gives a Song its Cover from the pictures the browser made, one
// UploadedPicture for each of CoverPictures. The pictures are kept if the Cover is
// added, and discarded otherwise. A Song with a Cover can't be given
// another.
func (s *Store) AddCover(ctx context.Context, songID int64, based Version, details CoverDetails, pictures map[CoverPicture]UploadedPicture) (Song, error) {
	return s.putCover(ctx, songID, based, details, pictures, false)
}

// ReplaceCover gives a Song with a Cover a new one in its place, as
// AddCover does, and deletes the old one's files. No past Covers are kept.
func (s *Store) ReplaceCover(ctx context.Context, songID int64, based Version, details CoverDetails, pictures map[CoverPicture]UploadedPicture) (Song, error) {
	return s.putCover(ctx, songID, based, details, pictures, true)
}

// putCover adds a Cover to a Song, replacing the one it has if replace is
// set, and refusing to otherwise.
func (s *Store) putCover(ctx context.Context, songID int64, based Version, details CoverDetails, pictures map[CoverPicture]UploadedPicture, replace bool) (Song, error) {
	return s.swapCover(ctx, songID, based, CoverPictures, pictures, func(tx *sql.Tx) (int64, newCover, error) {
		if msg := details.problem(); msg != "" {
			return 0, newCover{}, invalid(msg)
		}
		old, err := coverID(ctx, tx, songID)
		if err != nil {
			return 0, newCover{}, err
		}
		switch {
		case old != 0 && !replace:
			return 0, newCover{}, conflict("this Song already has a Cover")
		case old == 0 && replace:
			return 0, newCover{}, conflict("this Song has no Cover")
		}
		return old, newCover{details: details, addedAt: time.Now().UTC()}, nil
	})
}

// AdjustCoverCrop shows a new square of a Song's Cover's original, from the
// list and header pictures the browser made of it, one UploadedPicture for
// each of SquarePictures, which are kept if the crop is adjusted and
// discarded otherwise. The browser made them from the Cover with id from, so
// they're refused if the Song's Cover is another by now. The original is
// kept as it is.
func (s *Store) AdjustCoverCrop(ctx context.Context, songID int64, based Version, from int64, crop CoverCrop, pictures map[CoverPicture]UploadedPicture) (Song, error) {
	return s.swapCover(ctx, songID, based, SquarePictures, pictures, func(tx *sql.Tx) (int64, newCover, error) {
		var c newCover
		var old int64
		var added string
		err := tx.QueryRowContext(ctx,
			`SELECT id, width, height, original_type, added_at FROM covers WHERE song_id = ?`, songID).
			Scan(&old, &c.details.Width, &c.details.Height, &c.originalType, &added)
		if errors.Is(err, sql.ErrNoRows) {
			return 0, c, conflict("this Song has no Cover")
		}
		if err != nil {
			return 0, c, fmt.Errorf("reading cover: %w", err)
		}
		if old != from {
			return 0, c, conflict("this Song's Cover has changed")
		}
		c.details.Crop = crop
		if msg := c.details.problem(); msg != "" {
			return 0, c, invalid(msg)
		}
		if c.addedAt, err = parseTime(added); err != nil {
			return 0, c, err
		}
		return old, c, nil
	})
}

// newCover is a Cover about to take a Song's old one's place.
type newCover struct {
	details CoverDetails
	addedAt time.Time
	// originalType is the old Cover's original's, when it keeps it.
	originalType string
}

// swapCover gives a Song a new Cover, from the given pictures, uploaded,
// and the old Cover's original if that isn't among them. find says which
// Cover the Song has, or 0 for none, and what the new one is. The uploaded
// pictures are kept if the Cover is, and discarded otherwise, and the old
// Cover's files are deleted. The new Cover always gets a new id, so its
// pictures' addresses change.
func (s *Store) swapCover(ctx context.Context, songID int64, based Version, uploaded []CoverPicture,
	pictures map[CoverPicture]UploadedPicture, find func(tx *sql.Tx) (int64, newCover, error)) (Song, error) {
	for _, p := range uploaded {
		defer pictures[p].File.Discard()
	}
	types, err := typesOf(uploaded, pictures)
	if err != nil {
		return Song{}, err
	}
	var kept []CoverPicture
	var id, old int64
	err = s.changeTx(ctx, songID, based, func(tx *sql.Tx) error {
		var c newCover
		var err error
		if old, c, err = find(tx); err != nil {
			return err
		}
		if old != 0 {
			if err := deleteCover(ctx, tx, old); err != nil {
				return err
			}
		}
		if _, ok := types[CoverOriginal]; !ok {
			types[CoverOriginal] = c.originalType
		}
		id, err = insert(ctx, tx,
			`INSERT INTO covers (song_id, width, height, crop_x, crop_y, crop_size,
			   original_type, list_type, header_type, added_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			songID, c.details.Width, c.details.Height, c.details.Crop.X, c.details.Crop.Y, c.details.Crop.Size,
			types[CoverOriginal], types[CoverList], types[CoverHeader], c.addedAt.Format(timeFormat))
		if err != nil {
			return fmt.Errorf("adding cover: %w", err)
		}
		// Kept last, so nothing after them can fail but the commit.
		for _, p := range CoverPictures {
			if _, ok := pictures[p]; ok {
				err = pictures[p].File.Keep(id)
			} else {
				err = s.coverFiles[p].Link(old, id)
			}
			if err != nil {
				return err
			}
			kept = append(kept, p)
		}
		return nil
	})
	if err != nil {
		if len(kept) > 0 {
			s.removeCoverFiles(id)
		}
		return Song{}, err
	}
	if old != 0 {
		s.removeCoverFiles(old)
	}
	return s.GetSong(ctx, songID)
}

// typesOf checks the given pictures uploaded for a Cover and says what type
// each is.
func typesOf(uploaded []CoverPicture, pictures map[CoverPicture]UploadedPicture) (map[CoverPicture]string, error) {
	types := map[CoverPicture]string{}
	for _, p := range uploaded {
		t, _, err := mime.ParseMediaType(pictures[p].ContentType)
		if err != nil || !pictureTypes[t] {
			return nil, invalid("a Cover's pictures must be JPEG, PNG or WebP")
		}
		if pictures[p].File.Size == 0 {
			return nil, invalid("a Cover's pictures can't be empty")
		}
		types[p] = t
	}
	return types, nil
}

// RemoveCover deletes a Song's Cover and its files.
func (s *Store) RemoveCover(ctx context.Context, songID int64, based Version) (Song, error) {
	var id int64
	err := s.changeTx(ctx, songID, based, func(tx *sql.Tx) error {
		var err error
		if id, err = coverID(ctx, tx, songID); err != nil {
			return err
		}
		if id == 0 {
			return conflict("this Song has no Cover")
		}
		return deleteCover(ctx, tx, id)
	})
	if err != nil {
		return Song{}, err
	}
	s.removeCoverFiles(id)
	return s.GetSong(ctx, songID)
}

// loadCover reads a Song's Cover, or nil if it has none.
func loadCover(ctx context.Context, q queryer, songID int64) (*Cover, error) {
	var c Cover
	var added string
	err := q.QueryRowContext(ctx,
		`SELECT id, width, height, crop_x, crop_y, crop_size, added_at FROM covers WHERE song_id = ?`, songID).
		Scan(&c.ID, &c.Width, &c.Height, &c.Crop.X, &c.Crop.Y, &c.Crop.Size, &added)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading cover: %w", err)
	}
	if c.AddedAt, err = parseTime(added); err != nil {
		return nil, err
	}
	return &c, nil
}

// ServeCover answers a request for one of a Song's Cover's pictures.
func (s *Store) ServeCover(w http.ResponseWriter, r *http.Request, songID int64, picture CoverPicture) error {
	files, ok := s.coverFiles[picture]
	if !ok {
		return ErrNotFound
	}
	var id int64
	var contentType string
	// The column is named from a known picture, never from the request.
	err := s.db.QueryRowContext(r.Context(),
		`SELECT id, `+string(picture)+`_type FROM covers WHERE song_id = ?`, songID).Scan(&id, &contentType)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("reading cover: %w", err)
	}
	return files.Serve(w, r, id, contentType)
}

// coverID is a Song's Cover's id, or 0 if it has none.
func coverID(ctx context.Context, q queryer, songID int64) (int64, error) {
	var id int64
	err := q.QueryRowContext(ctx, `SELECT id FROM covers WHERE song_id = ?`, songID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("finding cover: %w", err)
	}
	return id, nil
}

// deleteCover deletes a Cover's row, leaving its files for once the change
// is committed.
func deleteCover(ctx context.Context, tx *sql.Tx, id int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM covers WHERE id = ?`, id); err != nil {
		return fmt.Errorf("deleting cover: %w", err)
	}
	return nil
}

// removeCoverFiles deletes the pictures of a Cover already gone from the
// database. A file left behind only takes space, so failures are logged.
func (s *Store) removeCoverFiles(id int64) {
	for _, p := range CoverPictures {
		if err := s.coverFiles[p].Remove(id); err != nil {
			log.Printf("deleting %s of cover %d: %v", p, id, err)
		}
	}
}
