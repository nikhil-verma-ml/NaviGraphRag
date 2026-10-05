import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Square, X, Loader2 } from 'lucide-react';
import { apiUrl } from '../utils/api.js';

interface VoiceRecorderButtonProps {
  onTranscriptionComplete: (text: string, sttMs?: number) => void;
  onError: (errorMsg: string) => void;
  onRecordingStart?: () => void;
  disabled?: boolean;
}

export const VoiceRecorderButton: React.FC<VoiceRecorderButtonProps> = ({
  onTranscriptionComplete,
  onError,
  onRecordingStart,
  disabled = false,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [hasDetectedSpeech, setHasDetectedSpeech] = useState(false);
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // VAD Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<any>(null);
  const speechDetectedRef = useRef(false);
  const lastSpeechTimeRef = useRef<number>(0);
  const autoStopTriggeredRef = useRef(false);

  // Timer counter during recording
  useEffect(() => {
    if (isRecording) {
      setRecordSeconds(0);
      timerIntervalRef.current = setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [isRecording]);

  const cleanupAudio = () => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setSilenceCountdown(null);
    setHasDetectedSpeech(false);
    speechDetectedRef.current = false;
    autoStopTriggeredRef.current = false;
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
      setIsRecording(false);
    }
  }, [isRecording]);

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      try {
        mediaRecorderRef.current.stop();
      } catch {}
      cleanupAudio();
      setIsRecording(false);
      audioChunksRef.current = [];
    }
  };

  const uploadAndTranscribe = async (audioBlob: Blob) => {
    setIsTranscribing(true);
    try {
      const ext = audioBlob.type.includes('mp4') ? 'm4a' : 'webm';
      const formData = new FormData();
      formData.append('file', audioBlob, `voice_query.${ext}`);

      const resp = await fetch(apiUrl('/voice/transcribe'), {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.error || `Transcription error (${resp.status})`);
      }

      const data = await resp.json();
      const transcribedText = (data.text || '').trim();

      if (!transcribedText) {
        onError('No speech detected in audio. Please try speaking again.');
      } else {
        onTranscriptionComplete(transcribedText, data.sttMs);
      }
    } catch (err: any) {
      console.warn('[uploadAndTranscribe] Error:', err);
      onError(err.message || 'Voice transcription failed.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const setupVAD = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const SPEECH_THRESHOLD = 20; // amplitude threshold
      const SILENCE_DURATION_MS = 1600; // auto-stop after 1.6s of silence post-speech

      speechDetectedRef.current = false;
      lastSpeechTimeRef.current = 0;
      autoStopTriggeredRef.current = false;

      vadIntervalRef.current = setInterval(() => {
        if (!mediaRecorderRef.current || autoStopTriggeredRef.current) return;

        analyser.getByteFrequencyData(dataArray);

        // Compute average volume level
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        const now = Date.now();

        if (average > SPEECH_THRESHOLD) {
          if (!speechDetectedRef.current) {
            speechDetectedRef.current = true;
            setHasDetectedSpeech(true);
          }
          lastSpeechTimeRef.current = now;
          setSilenceCountdown(null);
        } else if (speechDetectedRef.current) {
          const silentFor = now - lastSpeechTimeRef.current;
          const remaining = Math.max(0, Math.ceil((SILENCE_DURATION_MS - silentFor) / 1000));
          setSilenceCountdown(remaining);

          if (silentFor >= SILENCE_DURATION_MS && !autoStopTriggeredRef.current) {
            autoStopTriggeredRef.current = true;
            // Auto stop triggered by VAD!
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
              setIsRecording(false);
            }
          }
        }
      }, 100);
    } catch (vadErr) {
      console.warn('VAD setup skipped:', vadErr);
    }
  };

  const startRecording = async () => {
    if (isRecording || isTranscribing || disabled) return;

    // Barge-in: notify app to interrupt playing audio immediately
    onRecordingStart?.();

    audioChunksRef.current = [];

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access is not supported by your browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Determine supported mime type
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/wav',
      ];
      const mimeType = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        cleanupAudio();
        if (audioChunksRef.current.length === 0) {
          setIsRecording(false);
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });

        if (audioBlob.size < 1000) {
          setIsRecording(false);
          onError('Recording was too short. Please try speaking again.');
          return;
        }

        await uploadAndTranscribe(audioBlob);
      };

      recorder.start(250);
      setIsRecording(true);

      // Initialize Voice Activity Detection (VAD)
      setupVAD(stream);
    } catch (err: any) {
      console.warn('Microphone permission error:', err);
      cleanupAudio();
      setIsRecording(false);
      const isPermissionDenied =
        err.name === 'NotAllowedError' ||
        err.name === 'PermissionDeniedError' ||
        (err.message && err.message.toLowerCase().includes('denied'));

      onError(
        isPermissionDenied
          ? 'Microphone permission blocked. Please click the lock/camera icon in your address bar to allow microphone access.'
          : err.message || 'Could not start audio recording.'
      );
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // When transcribing
  if (isTranscribing) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium animate-pulse shrink-0">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
        <span>Transcribing...</span>
      </div>
    );
  }

  // When actively recording (with VAD indicator)
  if (isRecording) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-medium shadow-xs shrink-0">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
        </span>
        <span className="font-mono text-xs text-red-700">{formatSeconds(recordSeconds)}</span>

        <span className="text-[11px] text-red-600 hidden sm:inline">
          {hasDetectedSpeech
            ? silenceCountdown !== null
              ? `Auto-sending...`
              : `Listening...`
            : `Speak now...`}
        </span>

        {/* Done / Stop button */}
        <button
          type="button"
          onClick={stopRecording}
          className="p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors ml-1 shadow-xs"
          title="Done (Transcribe)"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
        </button>

        {/* Cancel button */}
        <button
          type="button"
          onClick={cancelRecording}
          className="p-1.5 text-red-600 hover:text-red-900 hover:bg-red-100 rounded-lg transition-colors"
          title="Cancel recording"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Idle Mic Button
  return (
    <button
      type="button"
      onClick={startRecording}
      disabled={disabled}
      className={`p-3 rounded-xl transition-all flex items-center justify-center shrink-0 ${
        disabled
          ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
          : 'bg-white hover:bg-slate-50 text-slate-700 hover:text-blue-600 border border-slate-300 hover:border-blue-400 shadow-xs active:scale-95'
      }`}
      title="Speak with microphone (Auto-detects silence to send)"
    >
      <Mic className="w-4 h-4 text-slate-600 hover:text-blue-600" />
    </button>
  );
};
