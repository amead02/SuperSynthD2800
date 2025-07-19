// SuperSynth DelayThing 2800 (Web Audio API version)
//
// This implementation avoids external dependencies by using the native
// Web Audio API.  A two‑octave keyboard is generated dynamically and
// connected to a polyphonic synth built from oscillators, a low‑pass
// filter and a feedback delay network.  Users can choose sine or
// sawtooth waveforms, shift the base octave, adjust the filter cutoff,
// and shape the delay effect (time, feedback and wet/dry mix).

(() => {
  // DOM references
  const keyboardEl = document.getElementById('keyboard');
  const waveformSelect = document.getElementById('waveform');
  const filterCutoff = document.getElementById('filterCutoff');
  const filterDisplay = document.getElementById('filterDisplay');
  const octaveDisplay = document.getElementById('octaveDisplay');
  const octaveDownBtn = document.getElementById('octaveDown');
  const octaveUpBtn = document.getElementById('octaveUp');
  const delayTime = document.getElementById('delayTime');
  const delayTimeDisplay = document.getElementById('delayTimeDisplay');
  const feedback = document.getElementById('feedback');
  const feedbackDisplay = document.getElementById('feedbackDisplay');
  const mix = document.getElementById('mix');
  const mixDisplay = document.getElementById('mixDisplay');

  // New effect controls
  const reverbCtrl = document.getElementById('reverb');
  const reverbDisplay = document.getElementById('reverbDisplay');

  // Reset button
  const resetButton = document.getElementById('resetButton');

  // The following lines have been commented out.  They were previously
  // used for debugging script load issues by appending a suffix to the
  // document title and setting the octave display to a placeholder.
  // If you need to debug script loading again, you can uncomment
  // these lines or add new diagnostics here.
  // try {
  //   document.title = `${document.title} — JS ready`;
  // } catch (err) {
  //   /* no-op */
  // }
  // if (octaveDisplay) {
  //   octaveDisplay.textContent = 'DBG';
  // }

  // Audio context and nodes
  let audioCtx;
  let filterNode;
  let delayNode;
  let feedbackGain;
  let wetGain;
  let dryGain;

  // Additional effect nodes
  let reverbNode;
  let reverbGain;

  // Application state
  let currentWave = waveformSelect.value; // 'sine' or 'sawtooth'
  let currentOctave = 4;
  const activeOscillators = {};

  // Track which computer keys are currently held down.  The keys in this
  // map correspond to entries in KEY_NOTE_MAP defined below.  When a key
  // is pressed, we store the noteId (e.g., "C4") so we know what to
  // release when the key is lifted.
  const keyboardActive = {};

  // Map computer keyboard keys to musical notes and octave offsets.  This
  // mapping is modelled after common DAW computer‑keyboard layouts
  // (e.g. Ableton Live’s Computer MIDI Keyboard).  The left home row
  // covers one octave from C through B, and the right side continues
  // into the next octave.  Sharp notes use the number row (w/e/t/y/u/o/p)
  // interleaved with the natural keys.
  const KEY_NOTE_MAP = {
    'a': { note: 'C', offset: 0 },
    'w': { note: 'C#', offset: 0 },
    's': { note: 'D', offset: 0 },
    'e': { note: 'D#', offset: 0 },
    'd': { note: 'E', offset: 0 },
    'f': { note: 'F', offset: 0 },
    't': { note: 'F#', offset: 0 },
    'g': { note: 'G', offset: 0 },
    'y': { note: 'G#', offset: 0 },
    'h': { note: 'A', offset: 0 },
    'u': { note: 'A#', offset: 0 },
    'j': { note: 'B', offset: 0 },
    // Continue into the second octave
    'k': { note: 'C', offset: 1 },
    'o': { note: 'C#', offset: 1 },
    'l': { note: 'D', offset: 1 },
    'p': { note: 'D#', offset: 1 },
    ';': { note: 'E', offset: 1 }
  };

  // Map note names to semitone offsets within an octave
  const NOTE_INDEX = {
    'C': 0,
    'C#': 1,
    'D': 2,
    'D#': 3,
    'E': 4,
    'F': 5,
    'F#': 6,
    'G': 7,
    'G#': 8,
    'A': 9,
    'A#': 10,
    'B': 11,
  };

  // Lazily initialise AudioContext and processing network when first note is played
  async function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Create nodes
    filterNode = audioCtx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = parseFloat(filterCutoff.value);

    delayNode = audioCtx.createDelay(5.0); // up to 5 s delay
    delayNode.delayTime.value = delayTime.value / 1000;

    feedbackGain = audioCtx.createGain();
    feedbackGain.gain.value = feedback.value / 100;

    wetGain = audioCtx.createGain();
    dryGain = audioCtx.createGain();
    // Mix: start 50/50
    const wetVal = mix.value / 100;
    wetGain.gain.value = wetVal;
    dryGain.gain.value = 1 - wetVal;

    // Connect the processing graph
    // Source → filter → dry → destination
    filterNode.connect(dryGain);
    dryGain.connect(audioCtx.destination);
    // Source → filter → delay → feedback → delay … → wet → destination
    filterNode.connect(delayNode);
    delayNode.connect(feedbackGain);
    feedbackGain.connect(delayNode);
    delayNode.connect(wetGain);
    wetGain.connect(audioCtx.destination);

    // --- Reverb ---
    // Create a simple convolution reverb using a generated impulse response.
    reverbNode = audioCtx.createConvolver();
    reverbGain = audioCtx.createGain();
    // Generate a 2‑second decaying noise impulse for a basic hall effect.
    {
      const duration = 2.0;
      const sampleRate = audioCtx.sampleRate;
      const length = Math.floor(sampleRate * duration);
      const impulse = audioCtx.createBuffer(2, length, sampleRate);
      for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
        const channelData = impulse.getChannelData(ch);
        for (let i = 0; i < length; i++) {
          // Exponentially decaying random noise
          channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
        }
      }
      reverbNode.buffer = impulse;
    }
    // Default reverb mix to zero
    reverbGain.gain.value = 0;
    // Connect reverb chain: filter → reverb → gain → destination
    filterNode.connect(reverbNode);
    reverbNode.connect(reverbGain);
    reverbGain.connect(audioCtx.destination);

    // --- Flanger ---
    // The user requested removal of the flanger effect.  The related nodes
    // and connections have been omitted.  Should you wish to re‑enable
    // flanging in the future, you can restore a modulated delay line here.
  }

  /**
   * Compute the frequency of a note given its name and octave.  Uses
   * A440 tuning: 440 Hz is note number 69 (A4).  MIDI note numbers start
   * at C‑1 = 0, but we base the calculation on C0 being MIDI 12, so
   * midi = (octave + 1) * 12 + NOTE_INDEX[noteName].
   */
  function noteToFrequency(noteName, octave) {
    const noteIndex = NOTE_INDEX[noteName];
    const midiNote = (octave + 1) * 12 + noteIndex;
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  // Build two octaves of keys (C–B) dynamically
  function buildKeyboard() {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    keyboardEl.innerHTML = '';
    for (let octaveOffset = 0; octaveOffset < 2; octaveOffset++) {
      notes.forEach((note) => {
        const key = document.createElement('div');
        key.classList.add('key');
        if (note.includes('#')) {
          key.classList.add('black');
        } else {
          key.classList.add('white');
        }
        key.dataset.note = note;
        key.dataset.offset = octaveOffset;
        const label = document.createElement('span');
        label.textContent = note;
        key.appendChild(label);
        keyboardEl.appendChild(key);
      });
    }
  }

  buildKeyboard();

  // Play a key: create oscillator, set type and frequency, connect to filter
  function playKey(el) {
    const noteName = el.dataset.note;
    const offset = parseInt(el.dataset.offset, 10);
    const octave = currentOctave + offset;
    const noteId = `${noteName}${octave}`;
    // If already playing, ignore
    if (activeOscillators[noteId]) return;
    const freq = noteToFrequency(noteName, octave);
    const osc = audioCtx.createOscillator();
    osc.type = currentWave;
    osc.frequency.value = freq;
    osc.connect(filterNode);
    osc.start();
    activeOscillators[noteId] = osc;
    el.classList.add('active');
  }

  // Release a key: stop and disconnect oscillator
  function stopKey(el) {
    const noteName = el.dataset.note;
    const offset = parseInt(el.dataset.offset, 10);
    const octave = currentOctave + offset;
    const noteId = `${noteName}${octave}`;
    const osc = activeOscillators[noteId];
    if (osc) {
      osc.stop();
      osc.disconnect();
      delete activeOscillators[noteId];
      el.classList.remove('active');
    }
  }

  /**
   * Play a note specified by its name (e.g. 'C' or 'G#') and an
   * octave offset relative to the currentOctave.  This is used when
   * triggering notes from the computer keyboard.  It behaves like
   * playKey() but does not rely on an existing DOM element; instead
   * it programmatically computes the frequency and highlights the
   * corresponding key on screen if present.
   */
  function playNote(noteName, octaveOffset) {
    const octave = currentOctave + octaveOffset;
    const noteId = `${noteName}${octave}`;
    // If already playing this note, ignore
    if (activeOscillators[noteId]) return;
    const freq = noteToFrequency(noteName, octave);
    const osc = audioCtx.createOscillator();
    osc.type = currentWave;
    osc.frequency.value = freq;
    osc.connect(filterNode);
    osc.start();
    activeOscillators[noteId] = osc;
    // Highlight the corresponding key element if one exists
    const keyEl = keyboardEl.querySelector(
      `.key[data-note="${noteName}"][data-offset="${octaveOffset}"]`
    );
    if (keyEl) keyEl.classList.add('active');
  }

  /**
   * Stop a note previously started by playNote().  This stops and
   * disconnects the oscillator and removes the highlight from the
   * corresponding DOM key.
   */
  function stopNote(noteName, octaveOffset) {
    const octave = currentOctave + octaveOffset;
    const noteId = `${noteName}${octave}`;
    const osc = activeOscillators[noteId];
    if (osc) {
      osc.stop();
      osc.disconnect();
      delete activeOscillators[noteId];
      // Remove highlight
      const keyEl = keyboardEl.querySelector(
        `.key[data-note="${noteName}"][data-offset="${octaveOffset}"]`
      );
      if (keyEl) keyEl.classList.remove('active');
    }
  }

  // Keyboard event listeners
  keyboardEl.addEventListener('mousedown', async (ev) => {
    const keyEl = ev.target.closest('.key');
    if (!keyEl) return;
    await initAudio();
    await audioCtx.resume();
    playKey(keyEl);
  });
  keyboardEl.addEventListener('mouseup', (ev) => {
    const keyEl = ev.target.closest('.key');
    if (!keyEl) return;
    stopKey(keyEl);
  });
  keyboardEl.addEventListener('mouseleave', (ev) => {
    const keyEl = ev.target.closest('.key');
    if (!keyEl) return;
    stopKey(keyEl);
  });
  keyboardEl.addEventListener('touchstart', async (ev) => {
    ev.preventDefault();
    const keyEl = ev.target.closest('.key');
    if (!keyEl) return;
    await initAudio();
    await audioCtx.resume();
    playKey(keyEl);
  }, { passive: false });
  keyboardEl.addEventListener('touchend', (ev) => {
    ev.preventDefault();
    const keyEl = ev.target.closest('.key');
    if (!keyEl) return;
    stopKey(keyEl);
  }, { passive: false });

  // Waveform selection
  waveformSelect.addEventListener('change', (ev) => {
    currentWave = ev.target.value;
  });

  // Filter cutoff control
  filterCutoff.addEventListener('input', (ev) => {
    const freq = parseFloat(ev.target.value);
    if (filterNode) {
      filterNode.frequency.setValueAtTime(freq, audioCtx.currentTime);
    }
    filterDisplay.textContent = Math.round(freq);
  });

  // Octave controls
  octaveDownBtn.addEventListener('click', () => {
    if (currentOctave > 1) {
      currentOctave--;
      octaveDisplay.textContent = `${currentOctave}`;
      // Debug: update document title so we can see if the event fires
      document.title = `SuperSynth DelayThing 2800 – Octave ${currentOctave}`;
    }
  });
  octaveUpBtn.addEventListener('click', () => {
    if (currentOctave < 7) {
      currentOctave++;
      octaveDisplay.textContent = `${currentOctave}`;
      // Debug: update document title so we can see if the event fires
      document.title = `SuperSynth DelayThing 2800 – Octave ${currentOctave}`;
    }
  });

  // Delay time control
  delayTime.addEventListener('input', (ev) => {
    const ms = parseFloat(ev.target.value);
    if (delayNode) {
      delayNode.delayTime.setValueAtTime(ms / 1000, audioCtx.currentTime);
    }
    delayTimeDisplay.textContent = Math.round(ms);
  });

  // Feedback control
  feedback.addEventListener('input', (ev) => {
    const pct = parseFloat(ev.target.value);
    const newVal = pct / 100;
    if (feedbackGain) {
      // When the feedback amount changes, ramp the gain smoothly to the new
      // value.  This prevents previously resonating echoes from persisting at
      // the old (higher) level – they will fade out over the ramp duration.
      const now = audioCtx.currentTime;
      feedbackGain.gain.cancelScheduledValues(now);
      feedbackGain.gain.setValueAtTime(feedbackGain.gain.value, now);
      feedbackGain.gain.linearRampToValueAtTime(newVal, now + 0.1);
    }
    feedbackDisplay.textContent = Math.round(pct);
  });

  // Mix control
  mix.addEventListener('input', (ev) => {
    const pct = parseFloat(ev.target.value) / 100;
    if (wetGain && dryGain) {
      wetGain.gain.setValueAtTime(pct, audioCtx.currentTime);
      dryGain.gain.setValueAtTime(1 - pct, audioCtx.currentTime);
    }
    mixDisplay.textContent = Math.round(pct * 100);
  });

  // Reverb control
  reverbCtrl.addEventListener('input', (ev) => {
    const pct = parseFloat(ev.target.value);
    const val = pct / 100;
    if (reverbGain) {
      const now = audioCtx.currentTime;
      reverbGain.gain.cancelScheduledValues(now);
      reverbGain.gain.setValueAtTime(reverbGain.gain.value, now);
      reverbGain.gain.linearRampToValueAtTime(val, now + 0.1);
    }
    reverbDisplay.textContent = Math.round(pct);
  });

  // Stop and reset button.  When clicked, stop all oscillators, clear
  // highlights and restore each control to its default value.  This
  // prevents runaway feedback loops and provides a quick way to return
  // to a known starting state.
  resetButton.addEventListener('click', () => {
    // Stop and remove all active oscillators
    for (const noteId of Object.keys(activeOscillators)) {
      const osc = activeOscillators[noteId];
      if (osc) {
        try {
          osc.stop();
        } catch (err) {}
        try {
          osc.disconnect();
        } catch (err) {}
        delete activeOscillators[noteId];
      }
    }
    // Remove highlights from keys
    const activeKeys = keyboardEl.querySelectorAll('.key.active');
    activeKeys.forEach((el) => el.classList.remove('active'));
    // Reset waveform to sine
    waveformSelect.value = 'sine';
    currentWave = 'sine';
    // Reset octave
    currentOctave = 4;
    octaveDisplay.textContent = '4';
    // Reset cutoff
    const cutoffDefault = 5000;
    filterCutoff.value = cutoffDefault;
    filterDisplay.textContent = `${cutoffDefault}`;
    if (filterNode && audioCtx) {
      filterNode.frequency.setValueAtTime(cutoffDefault, audioCtx.currentTime);
    }
    // Reset delay time (200 ms)
    const delayDefault = 200;
    delayTime.value = delayDefault;
    delayTimeDisplay.textContent = `${delayDefault}`;
    if (delayNode && audioCtx) {
      delayNode.delayTime.setValueAtTime(delayDefault / 1000, audioCtx.currentTime);
    }
    // Reset feedback (30%)
    const feedbackDefault = 30;
    feedback.value = feedbackDefault;
    feedbackDisplay.textContent = `${feedbackDefault}`;
    if (feedbackGain && audioCtx) {
      const now = audioCtx.currentTime;
      feedbackGain.gain.cancelScheduledValues(now);
      feedbackGain.gain.setValueAtTime(feedbackGain.gain.value, now);
      feedbackGain.gain.linearRampToValueAtTime(feedbackDefault / 100, now + 0.05);
    }
    // Reset mix (50%)
    const mixDefault = 50;
    mix.value = mixDefault;
    mixDisplay.textContent = `${mixDefault}`;
    if (wetGain && dryGain && audioCtx) {
      wetGain.gain.setValueAtTime(mixDefault / 100, audioCtx.currentTime);
      dryGain.gain.setValueAtTime(1 - mixDefault / 100, audioCtx.currentTime);
    }
    // Reset reverb (0%)
    const reverbDefault = 0;
    reverbCtrl.value = reverbDefault;
    reverbDisplay.textContent = `${reverbDefault}`;
    if (reverbGain && audioCtx) {
      const now = audioCtx.currentTime;
      reverbGain.gain.cancelScheduledValues(now);
      reverbGain.gain.setValueAtTime(reverbGain.gain.value, now);
      reverbGain.gain.linearRampToValueAtTime(0, now + 0.05);
    }
  });

  // --- Computer keyboard handling ---
  // Listen for keydown events to trigger notes.  Use the KEY_NOTE_MAP to
  // translate alphanumeric keys into note names and octave offsets.
  window.addEventListener('keydown', async (ev) => {
    const key = ev.key.toLowerCase();
    const mapping = KEY_NOTE_MAP[key];
    if (!mapping) return;
    // Prevent default to avoid unintended browser shortcuts
    ev.preventDefault();
    // Avoid retriggering if the key is already held down
    if (keyboardActive[key]) return;
    const { note, offset } = mapping;
    await initAudio();
    await audioCtx.resume();
    playNote(note, offset);
    keyboardActive[key] = true;
  });
  // Listen for keyup events to release notes.  Only release if the
  // key is currently active.
  window.addEventListener('keyup', (ev) => {
    const key = ev.key.toLowerCase();
    const mapping = KEY_NOTE_MAP[key];
    if (!mapping) return;
    if (!keyboardActive[key]) return;
    const { note, offset } = mapping;
    stopNote(note, offset);
    delete keyboardActive[key];
  });

})();