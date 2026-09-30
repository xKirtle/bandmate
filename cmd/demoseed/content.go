package main

// The demo content is lorem ipsum: it shows what Bandmate does, not a real
// Song, so nothing in it is anyone's lyrics.

// heroTitle names the hero Song, which shows off the features.
const heroTitle = "Lorem Ipsum"

// heroBPM is the hero Song's tempo, and its Beat's. A bar of 4/4 lasts
// 2.5 seconds, and each cued Line starts two bars after the one before.
const heroBPM = 96

// heroChordPro is the hero Song as imported: its Details, its Sections
// with Chords, and Cues from the timestamps on every Line but the
// Bridge's, which are left for Sync mode to cue.
const heroChordPro = `{title: ` + heroTitle + `}
{key: Am}
{bpm: 96}
{capo: 2}
{tuning: Standard}
{notes: Lorem ipsum dolor sit amet, keep the chorus light.}

[Intro]
[0:00.00] [Am] [F] [C] [G]

[Verse 1]
[0:05.00] [Am]Lorem ipsum [F]dolor sit amet
[0:10.00] Con[C]sectetur adipiscing [G]elit
[0:15.00] [Am]Sed do eiusmod [F]tempor
[0:20.00] In[C]cididunt ut la[G]bore

[Chorus]
[0:25.00] [F]Et dolore [C]magna aliqua
[0:30.00] [G]Ut enim ad [Am]minim veniam
[0:35.00] [F]Quis nostrud [C]exercitation
[0:40.00] [G]Ullamco laboris [E]nisi

[Verse 2]
[0:45.00] [Am]Ut aliquip ex [F]ea commodo
[0:50.00] Con[C]sequat duis aute [G]irure
[0:55.00] [Am]Dolor in repre[F]henderit
[1:00.00] In vo[C]luptate velit [G]esse

[Bridge]
[Dm]Cillum dolore eu [Am]fugiat
[Dm]Nulla pariatur ex[E]cepteur
[F]Sint occaecat cupi[G]datat
Non pro[E]ident sunt in culpa
`

// heroChorusAlternate is the text of the Chorus's second Alternate.
const heroChorusAlternate = `[F]Et dolore [C]magna, aliqua
[G]Ut enim [Am]minim, veniam
[F]Quis nostrud [C]ullamco
[G]Laboris nisi [E]ut aliquip`

// heroScrapbookLabel and heroScrapbookText are the hero Song's Scrapbook
// Section: a loose idea kept for later.
const (
	heroScrapbookLabel = "Hook idea"
	heroScrapbookText  = `[Am]Excepteur sint, [G]excepteur sint
[F]Occaecat cupidatat [E]non`
)

// otherSong is one of the Songs beside the hero Song, so the Song list and
// its filters have something to show.
type otherSong struct {
	chordPro string
	status   string
}

var otherSongs = []otherSong{
	{status: "finished", chordPro: `{title: Dolor Sit Amet}
{key: G}
{bpm: 84}

[Verse]
[G]Dolor sit amet, con[D]sectetur
[Em]Adipiscing elit [C]sed do

[Chorus]
[C]Eiusmod tempor [G]incididunt
[D]Ut labore et dolore
`},
	{status: "drafting", chordPro: `{title: Consectetur Adipiscing}
{key: Em}
{bpm: 120}

[Verse 1]
[Em]Consectetur adipiscing [C]elit
Sed do eiusmod [G]tempor

[Chorus]
[C]Magna aliqua, [D]ut enim
`},
	{status: "idea", chordPro: `{title: Sed Do Eiusmod}

[Verse]
Sed do eiusmod tempor incididunt
Ut labore et dolore magna
`},
	{status: "finished", chordPro: `{title: Tempor Incididunt}
{key: D}
{bpm: 100}

[Verse]
[D]Tempor incididunt ut [A]labore
[Bm]Et dolore magna [G]aliqua

[Chorus]
[G]Ut enim ad minim [A]veniam
`},
	{status: "drafting", chordPro: `{title: Magna Aliqua}
{key: F#m}
{bpm: 74}

[Verse]
[F#m]Magna aliqua, ut [D]enim ad minim
[A]Quis nostrud exer[E]citation
`},
	{status: "idea", chordPro: `{title: Ullamco Laboris}

[Hook]
Ullamco laboris nisi ut aliquip
Ex ea commodo consequat
`},
}
