package app_test

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/xKirtle/bandmate/internal/app"
)

// asYtDlp tells the test binary, started by the app as its yt-dlp, to stand
// in for yt-dlp rather than run the tests. The tests set it, so every
// program they start inherits it.
const asYtDlp = "BANDMATE_TEST_AS_YT_DLP"

func TestMain(m *testing.M) {
	if os.Getenv(asYtDlp) == "1" {
		os.Exit(fakeYtDlp(os.Args[1:]))
	}
	os.Setenv(asYtDlp, "1")
	os.Exit(m.Run())
}

// withFakeYtDlp has the app run the stand-in yt-dlp: this test binary.
func withFakeYtDlp(c *app.Config) {
	exe, err := os.Executable()
	if err != nil {
		panic(err)
	}
	c.YtDlp = exe
}

// fakeVideo is what the stand-in yt-dlp knows of a link, by its path.
type fakeVideo struct {
	info  map[string]any
	audio string
	// fail is yt-dlp's error, for links it can't fetch.
	fail string
}

// fakeAudio is the audio the stand-in fetches for a video, as the m4a
// yt-dlp would leave.
const fakeFetchedAudio = "fake m4a audio of Night"

// fakeVideos are the links the stand-in yt-dlp reads, by path. Anything on
// another host is an unsupported site.
var fakeVideos = map[string]fakeVideo{
	"/watch": {info: map[string]any{
		"_type":       "video",
		"title":       "[FREE] Night (prod. Kofi) 140 BPM",
		"channel":     "Kofi Beats",
		"webpage_url": "https://video.test/watch?v=night",
		"live_status": "not_live",
		"filesize":    len(fakeFetchedAudio),
	}, audio: fakeFetchedAudio},
	"/untitled": {info: map[string]any{
		"_type":       "video",
		"title":       "",
		"uploader":    "Somebody",
		"webpage_url": "https://video.test/untitled",
	}, audio: "fake audio"},
	"/playlist": {info: map[string]any{"_type": "playlist", "title": "Beats", "webpage_url": "https://video.test/playlist?list=PL1"}},
	"/@kofi":    {info: map[string]any{"_type": "playlist", "title": "Kofi Beats", "webpage_url": "https://video.test/@kofi/videos"}},
	"/live": {info: map[string]any{
		"_type": "video", "title": "Live beatmaking", "webpage_url": "https://video.test/live",
		"is_live": true, "live_status": "is_live",
	}},
	"/upcoming": {info: map[string]any{
		"_type": "video", "title": "Premiere", "webpage_url": "https://video.test/upcoming", "live_status": "is_upcoming",
	}},
	"/private": {fail: "ERROR: [test] private: Private video. Sign in if you've been granted access to this video"},
	"/gone":    {fail: "ERROR: [test] gone: Video unavailable. This video has been removed by the uploader"},
	"/members": {fail: "ERROR: [test] members: Join this channel to get access to members-only content like this video"},
	"/broken":  {fail: "ERROR: [test] broken: Unable to extract player response; please report this issue"},
	// Its size is known up front, and over any limit the tests set.
	"/huge": {info: map[string]any{
		"_type": "video", "title": "Huge", "webpage_url": "https://video.test/huge", "filesize_approx": 1 << 40,
	}},
	// Its size isn't known until it's fetched, and it keeps growing.
	"/growing": {info: map[string]any{"_type": "video", "title": "Growing", "webpage_url": "https://video.test/growing"}},
	// It never finishes. Its link's ?pidfile= says where it writes its process id.
	"/slow": {info: map[string]any{"_type": "video", "title": "Slow", "webpage_url": "https://video.test/slow"}},
}

// fakeYtDlp stands in for yt-dlp: with -J it prints a link's details, and
// with --load-info-json it fetches the audio those details are for.
func fakeYtDlp(args []string) int {
	arg := func(name string) string {
		if i := slices.Index(args, name); i >= 0 && i+1 < len(args) {
			return args[i+1]
		}
		return ""
	}
	for _, want := range []string{"--ignore-config", "--no-playlist"} {
		if !slices.Contains(args, want) {
			fmt.Fprintf(os.Stderr, "fake yt-dlp: %s is missing from %q\n", want, args)
			return 2
		}
	}
	if slices.Contains(args, "-J") {
		return fakeInfo(args[len(args)-1])
	}
	if !slices.Contains(args, "-x") || arg("--audio-format") != "m4a" || arg("--downloader") != "native" {
		fmt.Fprintf(os.Stderr, "fake yt-dlp: not asked for m4a audio with its own downloader: %q\n", args)
		return 2
	}
	data, err := os.ReadFile(arg("--load-info-json"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	var info struct {
		Link string `json:"original_url"`
	}
	if err := json.Unmarshal(data, &info); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	link, _ := url.Parse(info.Link)
	out := arg("-o")
	switch link.Path {
	case "/slow":
		os.WriteFile(link.Query().Get("pidfile"), []byte(strconv.Itoa(os.Getpid())), 0o644)
		time.Sleep(time.Minute)
		return 1
	case "/growing":
		limit, _ := strconv.Atoi(arg("--max-filesize"))
		os.WriteFile(strings.ReplaceAll(out, "%(ext)s", "webm.part"), make([]byte, limit+1), 0o644)
		time.Sleep(time.Minute)
		return 1
	}
	if err := os.WriteFile(strings.ReplaceAll(out, "%(ext)s", "m4a"), []byte(fakeVideos[link.Path].audio), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

func fakeInfo(link string) int {
	u, err := url.Parse(link)
	video, ok := fakeVideos[u.Path]
	if err != nil || u.Host != "video.test" || !ok {
		fmt.Fprintf(os.Stderr, "ERROR: Unsupported URL: %s\n", link)
		fmt.Println("null")
		return 1
	}
	if video.fail != "" {
		fmt.Fprintln(os.Stderr, video.fail)
		fmt.Println("null")
		return 1
	}
	info := map[string]any{"original_url": link}
	for k, v := range video.info {
		info[k] = v
	}
	json.NewEncoder(os.Stdout).Encode(info)
	return 0
}
