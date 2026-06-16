import { useCallback, useEffect, useRef, useState } from 'react';

// Wraps the browser Web Speech API for both directions:
//   - speech-to-text (SpeechRecognition) for dictating messages
//   - text-to-speech (speechSynthesis) for reading the Tin Man's replies aloud
// Both degrade gracefully: if the browser lacks support, `supported` is false
// and the calling UI hides the controls.

const SpeechRecognition =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

// Markdown reads badly aloud (asterisks, bullets, links). Flatten it to plain
// text, drop emoji/icons (so they aren't read out by name), and turn dashes
// into natural pauses (otherwise some voices literally say "dash").
function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // code fences
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1') // bold/italic
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/^\s*[-*+]\s+/gm, '') // bullets
    .replace(/^\s*>\s?/gm, '') // blockquotes
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '') // flag (regional indicator) pairs
    .replace(/\p{Extended_Pictographic}/gu, '') // emoji & pictographic icons
    .replace(/[︀-️‍]/g, '') // variation selectors + ZWJ leftovers
    .replace(/\s*[—–]+\s*/g, ', ') // em/en dash(es) -> pause
    .replace(/\s*-{2,}\s*/g, ', ') // double hyphen (--) used as a dash -> pause
    .replace(/\s+-\s+/g, ', ') // single spaced hyphen used as a dash -> pause
    .replace(/\n{2,}/g, '. ') // paragraph breaks -> pause
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1') // tidy spaces left before punctuation
    .replace(/([,.])\1+/g, '$1') // collapse doubled punctuation
    .trim();
}

export function useVoice() {
  const recognitionSupported = Boolean(SpeechRecognition);
  const speechSupported = Boolean(synth);

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognitionRef = useRef(null);
  const onResultRef = useRef(null);

  // Build the recognition instance once.
  useEffect(() => {
    if (!recognitionSupported) return;
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.onresult = (e) => {
      const text = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(' ')
        .trim();
      if (text && onResultRef.current) onResultRef.current(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    return () => {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    };
  }, [recognitionSupported]);

  const startListening = useCallback(
    (onResult) => {
      if (!recognitionRef.current || listening) return;
      onResultRef.current = onResult;
      try {
        recognitionRef.current.start();
        setListening(true);
      } catch {
        setListening(false);
      }
    },
    [listening]
  );

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const speak = useCallback(
    (text) => {
      if (!synth || !text) return;
      synth.cancel(); // never queue; replace whatever's playing
      const utter = new SpeechSynthesisUtterance(stripMarkdown(text));
      utter.rate = 1;
      utter.pitch = 1;
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      setSpeaking(true);
      synth.speak(utter);
    },
    []
  );

  const cancelSpeak = useCallback(() => {
    synth?.cancel();
    setSpeaking(false);
  }, []);

  // Stop any narration when the component using this hook unmounts.
  useEffect(() => () => synth?.cancel(), []);

  return {
    recognitionSupported,
    speechSupported,
    listening,
    speaking,
    startListening,
    stopListening,
    speak,
    cancelSpeak,
  };
}
