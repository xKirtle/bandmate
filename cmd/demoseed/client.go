package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
)

// client talks to a running Bandmate's HTTP API.
type client struct {
	base string
	http *http.Client
}

// call sends a request with body as JSON, if any, and decodes the answer
// into out, if any. An answer other than 2xx is an error.
func (c client) call(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	header := http.Header{}
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
		header.Set("Content-Type", "application/json")
	}
	return c.send(ctx, method, path, header, reader, out)
}

// upload sends a file of audio as the "file" part of a multipart form, with
// details as the "details" part, as the web app uploads Beats and Takes.
func (c client) upload(ctx context.Context, path, fileName string, file []byte, details, out any) error {
	var buf bytes.Buffer
	form := multipart.NewWriter(&buf)
	d, err := json.Marshal(details)
	if err != nil {
		return err
	}
	if err := form.WriteField("details", string(d)); err != nil {
		return err
	}
	part, err := form.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {fmt.Sprintf(`form-data; name="file"; filename=%q`, fileName)},
		"Content-Type":        {"audio/wav"},
	})
	if err != nil {
		return err
	}
	if _, err := part.Write(file); err != nil {
		return err
	}
	if err := form.Close(); err != nil {
		return err
	}
	header := http.Header{"Content-Type": {form.FormDataContentType()}}
	return c.send(ctx, http.MethodPost, path, header, &buf, out)
}

// send sends a request with header and body, and decodes the answer into
// out, if any. An answer other than 2xx is an error.
func (c client) send(ctx context.Context, method, path string, header http.Header, body io.Reader, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimSuffix(c.base, "/")+path, body)
	if err != nil {
		return err
	}
	req.Header = header
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	answer, err := io.ReadAll(res.Body)
	if err != nil {
		return fmt.Errorf("%s %s: reading the answer: %w", method, path, err)
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("%s %s: %s: %s", method, path, res.Status, bytes.TrimSpace(answer))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(answer, out); err != nil {
		return fmt.Errorf("%s %s: decoding the answer: %w", method, path, err)
	}
	return nil
}
