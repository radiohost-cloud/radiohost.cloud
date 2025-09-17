
import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState, useCallback } from 'react';
import { type Track } from '../types';
import { getTrackSrc } from '../services/dataService';

export interface PlayerRef {
  play: (track: Track) => void;
  pause: () => void;
  resume: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  playPfl: (track: Track) => void;
  stopPfl: () => void;
  setPflVolume: (volume: number) => void;
  getMainAudioElement: () => HTMLAudioElement | null;
  getPflAudioElement: () => HTMLAudioElement | null;
}

interface PlayerProps {
  onProgress: (progress: number, duration: number) => void;
  onTrackEnd: () => void;
  onStateChange: (isPlaying: boolean) => void;
  onPflProgress: (progress: number, duration: number) => void;
  onPflStateChange: (isPlaying: boolean) => void;
  crossfadeDuration: number;
}

const Player = forwardRef<PlayerRef, PlayerProps>((props, ref) => {
  const mainAudioRef = useRef<HTMLAudioElement>(null);
  const pflAudioRef = useRef<HTMLAudioElement>(null);
  
  const progressIntervalRef = useRef<number | null>(null);
  const pflProgressIntervalRef = useRef<number | null>(null);

  const startProgressInterval = useCallback(() => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = window.setInterval(() => {
      if (mainAudioRef.current) {
        props.onProgress(mainAudioRef.current.currentTime, mainAudioRef.current.duration);
      }
    }, 250);
  }, [props]);

  const stopProgressInterval = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);
  
  const startPflProgressInterval = useCallback(() => {
    if (pflProgressIntervalRef.current) clearInterval(pflProgressIntervalRef.current);
    pflProgressIntervalRef.current = window.setInterval(() => {
      if (pflAudioRef.current) {
        props.onPflProgress(pflAudioRef.current.currentTime, pflAudioRef.current.duration);
      }
    }, 250);
  }, [props]);
  
  const stopPflProgressInterval = useCallback(() => {
      if (pflProgressIntervalRef.current) {
        clearInterval(pflProgressIntervalRef.current);
        pflProgressIntervalRef.current = null;
      }
  }, []);

  useEffect(() => {
    const mainAudio = mainAudioRef.current;
    if (!mainAudio) return;

    const handleEnded = () => {
      props.onStateChange(false);
      stopProgressInterval();
      props.onTrackEnd();
    };

    const handlePlay = () => {
        props.onStateChange(true);
        startProgressInterval();
    };

    const handlePause = () => {
      props.onStateChange(false);
      stopProgressInterval();
    };
    
    mainAudio.addEventListener('ended', handleEnded);
    mainAudio.addEventListener('play', handlePlay);
    mainAudio.addEventListener('pause', handlePause);
    
    // PFL Audio Listeners
    const pflAudio = pflAudioRef.current;
    if (!pflAudio) return;
    
    const handlePflEnded = () => {
        props.onPflStateChange(false);
        stopPflProgressInterval();
        props.onPflProgress(0, pflAudio.duration || 0);
    };
    
    const handlePflPlay = () => {
        props.onPflStateChange(true);
        startPflProgressInterval();
    };
    
    const handlePflPause = () => {
        props.onPflStateChange(false);
        stopPflProgressInterval();
    };
    
    pflAudio.addEventListener('ended', handlePflEnded);
    pflAudio.addEventListener('play', handlePflPlay);
    pflAudio.addEventListener('pause', handlePflPause);

    return () => {
      mainAudio.removeEventListener('ended', handleEnded);
      mainAudio.removeEventListener('play', handlePlay);
      mainAudio.removeEventListener('pause', handlePause);
      stopProgressInterval();
      
      pflAudio.removeEventListener('ended', handlePflEnded);
      pflAudio.removeEventListener('play', handlePflPlay);
      pflAudio.removeEventListener('pause', handlePflPause);
      stopPflProgressInterval();
    };
  }, [props, startProgressInterval, stopProgressInterval, startPflProgressInterval, stopPflProgressInterval]);


  useImperativeHandle(ref, () => ({
    async play(track) {
      const mainAudio = mainAudioRef.current;
      if (!mainAudio) return;
      const src = await getTrackSrc(track);
      if (src) {
        mainAudio.src = src;
        mainAudio.play().catch(e => console.error("Audio play failed:", e));
      }
    },
    pause() {
      mainAudioRef.current?.pause();
    },
    resume() {
      mainAudioRef.current?.play().catch(e => console.error("Audio resume failed:", e));
    },
    seek(time) {
      if (mainAudioRef.current) {
        mainAudioRef.current.currentTime = time;
      }
    },
    setVolume(volume) {
      if (mainAudioRef.current) {
        mainAudioRef.current.volume = volume;
      }
    },
    async playPfl(track) {
        const pflAudio = pflAudioRef.current;
        if (!pflAudio) return;
        const src = await getTrackSrc(track);
        if (src) {
            pflAudio.src = src;
            pflAudio.play().catch(e => console.error("PFL play failed:", e));
        }
    },
    stopPfl() {
        const pflAudio = pflAudioRef.current;
        if (pflAudio) {
            pflAudio.pause();
            pflAudio.currentTime = 0;
        }
    },
    setPflVolume(volume) {
      if (pflAudioRef.current) {
        pflAudioRef.current.volume = volume;
      }
    },
    getMainAudioElement: () => mainAudioRef.current,
    getPflAudioElement: () => pflAudioRef.current,
  }));

  // Render audio elements, but they are not visible to the user.
  // The `id` attributes are used to connect them to the AudioContext in App.tsx
  return (
    <>
      <audio ref={mainAudioRef} id="main-player-audio-element" crossOrigin="anonymous" />
      <audio ref={pflAudioRef} id="pfl-player-audio-element" crossOrigin="anonymous" />
    </>
  );
});

export default Player;
