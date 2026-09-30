// Command demoseed fills an empty Bandmate with demo content through its
// HTTP API, for the screenshots in docs/screenshots: a hero Song showing
// off the features, and a few other Songs for the Song list. All of it is
// lorem ipsum, and its audio is generated.
//
//	go run ./cmd/demoseed [-url http://localhost:8080]
//
// It refuses a Bandmate that already has Songs or Beats.
package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"time"
)

func main() {
	url := flag.String("url", "http://localhost:8080", "the Bandmate to seed")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := seed(ctx, *url, http.DefaultClient); err != nil {
		fmt.Fprintln(os.Stderr, "demoseed:", err)
		os.Exit(1)
	}
	fmt.Println("seeded", *url)
}
