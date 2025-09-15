
import React, { useRef, useEffect } from 'react';

interface WaveformProps {
  audioBuffer: AudioBuffer | null;
  height: number;
  width: number;
  color?: string;
  fadeInDuration?: number;
  fadeOutDuration?: number;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
}

const Waveform: React.FC<WaveformProps> = React.memo(({ audioBuffer, height, width, color = '#9ca3af', fadeInDuration = 0, fadeOutDuration = 0, trimStartSeconds = 0, trimEndSeconds = 0 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    if (!audioBuffer) return;
    
    const originalDuration = audioBuffer.duration;
    if (originalDuration === 0) return;

    const effectiveDuration = originalDuration - trimStartSeconds - trimEndSeconds;
    if (effectiveDuration <= 0) return;

    const pixelsPerSecond = width / effectiveDuration;
    const fadeInPixels = fadeInDuration * pixelsPerSecond;
    const fadeOutPixels = fadeOutDuration * pixelsPerSecond;
    
    const startFrame = Math.floor(trimStartSeconds * audioBuffer.sampleRate);
    const data = audioBuffer.getChannelData(0);
    const dataLength = Math.floor(effectiveDuration * audioBuffer.sampleRate);
    if (startFrame + dataLength > data.length) return;

    const step = Math.ceil(dataLength / width);
    const amp = height / 2;
    
    ctx.fillStyle = color;
    
    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      const frameOffset = i * step;

      for (let j = 0; j < step; j++) {
        const datum = data[startFrame + frameOffset + j];
        if (datum === undefined) continue;
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      
      let fadeMultiplier = 1.0;
      if (fadeInPixels > 0 && i < fadeInPixels) {
        fadeMultiplier = i / fadeInPixels;
      } else if (fadeOutPixels > 0 && i > width - fadeOutPixels) {
        fadeMultiplier = (width - i) / fadeOutPixels;
      }
      
      const finalMin = min * fadeMultiplier;
      const finalMax = max * fadeMultiplier;

      ctx.fillRect(i, (1 + finalMin) * amp, 1, Math.max(1, (finalMax - finalMin) * amp));
    }
  }, [audioBuffer, height, width, color, fadeInDuration, fadeOutDuration, trimStartSeconds, trimEndSeconds]);

  return <canvas ref={canvasRef} width={width} height={height} className="block" />;
});

export default Waveform;
