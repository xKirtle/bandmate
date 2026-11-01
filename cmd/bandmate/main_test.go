package main

import "testing"

func TestReadOff(t *testing.T) {
	cases := []struct {
		value   string
		off     bool
		refused bool
	}{
		{value: "", off: false},
		{value: "true", off: false},
		{value: "TRUE", off: false},
		{value: "false", off: true},
		{value: "False", off: true},
		// Settings from before it took true and false keep working.
		{value: "on", off: false},
		{value: "off", off: true},
		{value: "OFF", off: true},
		{value: "maybe", refused: true},
		{value: "1", refused: true},
	}
	for _, c := range cases {
		t.Run(c.value, func(t *testing.T) {
			t.Setenv("BANDMATE_TEST_SWITCH", c.value)
			off, err := readOff("BANDMATE_TEST_SWITCH")
			if c.refused {
				want := `BANDMATE_TEST_SWITCH must be "true" or "false"`
				if err == nil || err.Error() != want {
					t.Fatalf("err = %v, want %s", err, want)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if off != c.off {
				t.Fatalf("off = %v, want %v", off, c.off)
			}
		})
	}
}
