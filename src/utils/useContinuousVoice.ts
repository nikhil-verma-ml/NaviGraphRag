import { useState, useRef, useEffect, useCallback } from 'react';
import { apiUrl } from './api.js';

interface ContinuousVoiceOptions {
  onSpeechTranscribed: (text: string, sttMs?: number) => void;
  onBargeInDetected: () => void;
  onError: (errMsg: string) => void;
  isSpeaking: boolean;
  isThinking: boolean;
}

export function useContinuousVoice({
  onSpeechTranscribed,
  onBargeInDetected,
  onError,
  isSpeaking,
  isThinking,
}: ContinuousVoiceOptions) {
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<any>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);

  const isSpeakingRef = useRef(isSpeaking);
  isSpeakingRef.current = isSpeaking;

  const isThinkingRef = useRef(isThinking);
  isThinkingRef.current = isThinking;

  const speechDetectedRef = useRef(false);
  const lastSpeechTimeRef = useRef<number>(0);
  const autoStopTriggeredRef = useRef(false);

  const speakingStartTimeRef = useRef<number>(0);
  const consecutiveLoudFramesRef = useRef<number>(0);
  const prevSpeakingRef = useRef<boolean>(false);

  if (!prevSpeakingRef.current && isSpeaking) {
    speakingStartTimeRef.current = Date.now();
    consecutiveLoudFramesRef.current = 0;
  }
  prevSpeakingRef.current = isSpeaking;

  const cleanupAudio = useCallback(() => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    micAnalyserRef.current = null;
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close().catch(() => {});
      } catch {}
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch {}
      streamRef.current = null;
    }
    speechDetectedRef.current = false;
    autoStopTriggeredRef.current = false;
    setAudioLevel(0);
  }, []);

  const uploadAndTranscribe = async (audioBlob: Blob) => {
    try {
      const ext = audioBlob.type.includes('mp4') ? 'm4a' : 'webm';
      const formData = new FormData();
      formData.append('file', audioBlob, `voice_stream.${ext}`);

      const resp = await fetch(apiUrl('/voice/transcribe'), {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        throw new Error(`Transcription failed (${resp.status})`);
      }

      const data = await resp.json();
      const transcribedText = (data.text || '').trim();

      if (transcribedText) {
        onSpeechTranscribed(transcribedText, data.sttMs);
      } else {
        // No speech detected, resume listening if appropriate
        onError('No speech detected. Please speak your question.');
      }
    } catch (err: any) {
      console.warn('[ContinuousVoice] Transcribe error:', err);
      onError(err.message || 'Voice transcription failed.');
    }
  };

  const startListening = useCallback(async () => {
    cleanupAudio();
    audioChunksRef.current = [];
    autoStopTriggeredRef.current = false;
    speechDetectedRef.current = false;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access is not supported by your browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // AudioContext for VAD & Level visualization
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        micAnalyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const SPEECH_THRESHOLD = 22;
        const SILENCE_DURATION_MS = 1500;

        vadIntervalRef.current = setInterval(() => {
          if (!mediaRecorderRef.current || autoStopTriggeredRef.current) return;

          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avgLevel = sum / dataArray.length;
          setAudioLevel(avgLevel);

          const now = Date.now();

          // Barge-in check: If AI is currently speaking, require sustained intentional user speech (above echo level)
          if (isSpeakingRef.current) {
            const elapsedSpeaking = now - speakingStartTimeRef.current;
            // Echo gating: ignore first 1000ms of speech start and require sustained loud voice
            if (elapsedSpeaking > 1000 && avgLevel > 44) {
              consecutiveLoudFramesRef.current++;
              if (consecutiveLoudFramesRef.current >= 3) {
                console.log('[useContinuousVoice] Intentional user barge-in detected. Level:', avgLevel);
                consecutiveLoudFramesRef.current = 0;
                onBargeInDetected();
              }
            } else {
              consecutiveLoudFramesRef.current = 0;
            }
            return;
          }

          // If in thinking mode, don't accumulate speech
          if (isThinkingRef.current) return;

          if (avgLevel > SPEECH_THRESHOLD) {
            speechDetectedRef.current = true;
            lastSpeechTimeRef.current = now;
          } else if (speechDetectedRef.current) {
            const silentFor = now - lastSpeechTimeRef.current;
            if (silentFor >= SILENCE_DURATION_MS && !autoStopTriggeredRef.current) {
              autoStopTriggeredRef.current = true;
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                try {
                  mediaRecorderRef.current.stop();
                } catch {}
                setIsListening(false);
              }
            }
          }
        }, 100);
      }

      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg',
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
        setIsListening(false);

        if (audioChunksRef.current.length === 0) return;

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });

        if (audioBlob.size > 800) {
          await uploadAndTranscribe(audioBlob);
        }
      };

      recorder.start(250);
      setIsListening(true);
    } catch (err: any) {
      cleanupAudio();
      setIsListening(false);
      const isPermissionDenied =
        err.name === 'NotAllowedError' ||
        err.name === 'PermissionDeniedError' ||
        (err.message && err.message.toLowerCase().includes('denied'));

      if (isPermissionDenied) {
        onError(
          'Microphone permission blocked. Please allow microphone access in your browser settings (click the lock/camera icon in your address bar).'
        );
      } else {
        onError(err.message || 'Microphone access denied.');
      }
    }
  }, [cleanupAudio, onError, onBargeInDetected]);

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current && isListening) {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    cleanupAudio();
    setIsListening(false);
  }, [cleanupAudio, isListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [cleanupAudio]);

  return {
    isListening,
    audioLevel,
    micAnalyser: micAnalyserRef.current,
    startListening,
    stopListening,
  };
}
