package main

import (
	"errors"
	"flag"
	"fmt"
	"math/rand"
	"os"
	"os/exec"
	"strings"
	"time"
	"unicode"
)

func main() {
	waitSeconds := flag.Int("Typing will start in", 5, "seconds.")
	charDelay := flag.Int("delay", 12, "milliseconds between characters")
	allowLong := flag.Bool("long", false, "allow clipboard text longer than 500 characters")
	flag.Parse()

	text, source, err := clipboardText()
	if err != nil {
		exitf("could not read clipboard: %v", err)
	}
	if strings.TrimSpace(text) == "" {
		exitf("clipboard is empty")
	}
	if !*allowLong && len([]rune(text)) > 500 {
		exitf("clipboard text is more than 500 characters; pass --long to allow it")
	}

	fmt.Printf("Clipboard source: %s\n", source)
	fmt.Printf("Text length: %d\n", len([]rune(text)))
	fmt.Printf("Typing starts in %d seconds\n", *waitSeconds)
	time.Sleep(time.Duration(*waitSeconds) * time.Second)

	typedBy, err := typeText(text, *charDelay)
	if err != nil {
		exitf("could not type text: %v", err)
	}

	fmt.Printf("Done. Typed with: %s\n", typedBy)
}

func clipboardText() (string, string, error) {
	type reader struct {
		name string
		args []string
	}

	readers := []reader{
		{name: "wl-paste", args: []string{"wl-paste", "-n"}},
		{name: "xclip", args: []string{"xclip", "-selection", "clipboard", "-o"}},
		{name: "xsel", args: []string{"xsel", "--clipboard", "--output"}},
	}

	for _, r := range readers {
		if !commandExists(r.args[0]) {
			continue
		}
		out, err := exec.Command(r.args[0], r.args[1:]...).Output()
		if err != nil {
			continue
		}
		return string(out), r.name, nil
	}

	return "", "", errors.New("no clipboard reader found (install wl-clipboard, xclip, or xsel)")
}

func typeText(text string, delayMS int) (string, error) {
	wayland := os.Getenv("WAYLAND_DISPLAY") != ""
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	if wayland && commandExists("wtype") {
		for _, r := range []rune(text) {
			cmd := exec.Command("wtype", string(r))
			if err := cmd.Run(); err != nil {
				return "", err
			}
			time.Sleep(randomDelay(delayMS, r, rng))
		}
		return "wtype", nil
	}

	if commandExists("xdotool") {
		for _, r := range []rune(text) {
			cmd := exec.Command("xdotool", "type", "--clearmodifiers", string(r))
			if err := cmd.Run(); err != nil {
				return "", err
			}
			time.Sleep(randomDelay(delayMS, r, rng))
		}
		return "xdotool", nil
	}

	if commandExists("ydotool") {
		for _, r := range []rune(text) {
			cmd := exec.Command("ydotool", "type", string(r))
			if err := cmd.Run(); err != nil {
				return "", err
			}
			time.Sleep(randomDelay(delayMS, r, rng))
		}
		return "ydotool", nil
	}

	return "", errors.New("no typing backend found (install wtype, xdotool, or ydotool)")
}

func commandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func randomDelay(baseMS int, r rune, rng *rand.Rand) time.Duration {
	if baseMS < 1 {
		baseMS = 1
	}

	// Slight variation per character: 80%-120% of base.
	min := maxInt(1, (baseMS*8)/10)
	max := maxInt(min, (baseMS*12)/10)
	delay := min + rng.Intn(max-min+1)

	// Add a bit more variation between words.
	if unicode.IsSpace(r) {
		wordExtraMin := maxInt(1, baseMS/2)
		wordExtraMax := maxInt(wordExtraMin, baseMS*2)
		delay += wordExtraMin + rng.Intn(wordExtraMax-wordExtraMin+1)
	}

	return time.Duration(delay) * time.Millisecond
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func exitf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "Error: "+format+"\n", args...)
	os.Exit(1)
}
