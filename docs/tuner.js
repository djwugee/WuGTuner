const Tuner = function (a4) {
  this.middleA = a4 || 440;
  this.semitone = 69;
  this.bufferSize = 4096;
  this.noteStrings = [
    "C",
    "C♯",
    "D",
    "D♯",
    "E",
    "F",
    "F♯",
    "G",
    "G♯",
    "A",
    "A♯",
    "B",
  ];
  // New state variables:
  this.currentNote = null;
  this.currentNoteStartTime = null;
  this.NOTE_SWITCH_THRESHOLD = 0; // e.g., 1 second.

  this.initGetUserMedia();
};

Tuner.prototype.initGetUserMedia = function () {
  window.AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!window.AudioContext) {
    return alert("AudioContext not supported");
  }

  // Older browsers might not implement mediaDevices at all, so we set an empty object first
  if (navigator.mediaDevices === undefined) {
    navigator.mediaDevices = {};
  }

  // Some browsers partially implement mediaDevices. We can't just assign an object
  // with getUserMedia as it would overwrite existing properties.
  // Here, we will just add the getUserMedia property if it's missing.
  if (navigator.mediaDevices.getUserMedia === undefined) {
    navigator.mediaDevices.getUserMedia = function (constraints) {
      // First get ahold of the legacy getUserMedia, if present
      const getUserMedia =
        navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

      // Some browsers just don't implement it - return a rejected promise with an error
      // to keep a consistent interface
      if (!getUserMedia) {
        alert("getUserMedia is not implemented in this browser");
      }

      // Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
      return new Promise(function (resolve, reject) {
        getUserMedia.call(navigator, constraints, resolve, reject);
      });
    };
  }
};


Tuner.prototype.startRecord = function () {
  const self = this;
  
  // Function to create a bandpass filter
  // function createBandpassFilter(context) {
  //  const filter = context.createBiquadFilter();
  //  filter.type = "bandpass";
  //  filter.frequency.value = 84;
  //  filter.Q.value = Math.log(1400/60) / Math.LN2;
  //  return filter;
  //}

  const noiseGateThreshold = 0.05; // adjust to suitable level
  const detectionCooldown = 0; // in milliseconds
  let lastDetectionTime = 0;
  
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then(function (stream) {
      self.audioContext.createMediaStreamSource(stream).connect(self.analyser);
      self.analyser.connect(self.scriptProcessor);
      self.scriptProcessor.connect(self.audioContext.destination);
      self.scriptProcessor.addEventListener("audioprocess", function (event) {
        const inputData = event.inputBuffer.getChannelData(0);
        const rms = Math.sqrt(inputData.reduce((a, b) => a + b * b, 0) / inputData.length);
        
        if (rms < noiseGateThreshold) {
          // RMS below threshold, consider it noise and ignore
          return;
        }
      
        const currentTime = Date.now();
        if (currentTime - lastDetectionTime < detectionCooldown) {
          // if we are still within the cooldown period, don't detect another note
          return;
        }
      
        const frequency = self.pitchDetector.do(
          event.inputBuffer.getChannelData(0)
        );
      
        if (frequency) {
          const note = self.getNote(frequency);
        
          // If we're still on the same note, do nothing. 
          // If we've switched to a new note, reset the current note and the start time:
          if (note !== self.currentNote) {
            self.currentNote = note;
            self.currentNoteStartTime = currentTime;
          }
      
          // If we have a current note and it's been less than the threshold time, ignore new notes:
          if (self.currentNote !== null && currentTime - self.currentNoteStartTime < self.NOTE_SWITCH_THRESHOLD) {
            return;
          }
        }
        
        if (frequency && self.onNoteDetected) {
          const note = self.getNote(frequency);
          self.onNoteDetected({
            name: self.noteStrings[note % 12],
            value: note,
            cents: self.getCents(frequency, note),
            octave: parseInt(note / 12) - 1,
            frequency: frequency,
          });
          // update the time of last detection
          lastDetectionTime = currentTime;
        }
      }); // This was the missing parenthesis
    })
    .catch(function (error) {
      alert(error.name + ": " + error.message);
    });
};

Tuner.prototype.init = function () {
  this.audioContext = new window.AudioContext();
  this.analyser = this.audioContext.createAnalyser();
  this.scriptProcessor = this.audioContext.createScriptProcessor(
    this.bufferSize,
    1,
    1
  );

  const self = this;

  aubio().then(function (aubio) {
    self.pitchDetector = new aubio.Pitch(
      "yinfft",
      self.bufferSize,
      1,
      self.audioContext.sampleRate
    );
    self.startRecord();
  });
};

/**
 * get musical note from frequency
 *
 * @param {number} frequency
 * @returns {number}
 */
Tuner.prototype.getNote = function (frequency) {
  const note = 12 * (Math.log(frequency / this.middleA) / Math.log(2));
  return Math.round(note) + this.semitone;
};

/**
 * get the musical note's standard frequency
 *
 * @param note
 * @returns {number}
 */
Tuner.prototype.getStandardFrequency = function (note) {
  return this.middleA * Math.pow(2, (note - this.semitone) / 12);
};

/**
 * get cents difference between given frequency and musical note's standard frequency
 *
 * @param {number} frequency
 * @param {number} note
 * @returns {number}
 */
Tuner.prototype.getCents = function (frequency, note) {
  return Math.floor(
    (1200 * Math.log(frequency / this.getStandardFrequency(note))) / Math.log(2)
  );
};

Tuner.prototype.createBandpassFilter = function() {
  const filter = this.audioContext.createBiquadFilter();
  // Set the type to bandpass
  filter.type = "bandpass";
  // Set the lower frequency limit (in Hertz) - Low E String
  filter.frequency.value = 82; 
  // Set the bandwidth of the filter (in Cents)
  filter.Q.value = Math.log(1318/50) / Math.LN2;
  
  return filter;
};

/**
 * play the musical note
 *
 * @param {number} frequency
 */
Tuner.prototype.play = function (frequency) {
  if (!this.oscillator) {
    this.oscillator = this.audioContext.createOscillator();
    this.oscillator.connect(this.audioContext.destination);
    this.oscillator.start();
  }
  this.oscillator.frequency.value = frequency;
};

Tuner.prototype.stopOscillator = function () {
  if (this.oscillator) {
    this.oscillator.stop();
    this.oscillator = null;
  }
};
