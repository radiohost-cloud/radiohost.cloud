
import React, { useRef, useEffect } from 'react';

interface VUMeterProps {
  analyserNode: AnalyserNode | null;
}

const VUMeter: React.FC<VUMeterProps> = ({ analyserNode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!analyserNode) return;

    const canvas = canvasRef.current;
    const canvasCtx = canvas?.getContext('2d');
    if (!canvas || !canvasCtx) return;
    
    let animationFrameId: number;

    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);
      
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvasCtx.scale(dpr, dpr);
      }
      const logicalWidth = rect.width;
      const logicalHeight = rect.height;

      analyserNode.fftSize = 256;
      const bufferLength = analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      analyserNode.getByteTimeDomainData(dataArray);
      let sumSquares = 0.0;
      for (const amplitude of dataArray) {
          const normalizedAmplitude = (amplitude / 128.0) - 1.0;
          sumSquares += normalizedAmplitude * normalizedAmplitude;
      }
      const rms = Math.sqrt(sumSquares / bufferLength);
      const level = Math.min(1.0, rms * 4); 

      canvasCtx.clearRect(0, 0, logicalWidth, logicalHeight);
      
      const barCount = 20;
      const gap = 2; // gap in pixels
      const barHeight = (logicalHeight - (barCount - 1) * gap) / barCount;
      const onBars = Math.round(level * barCount);

      for (let i = 0; i < barCount; i++) {
        const y = logicalHeight - (i * (barHeight + gap)) - barHeight;
        
        let color = '#4ade80'; // Green
        if (i > barCount * 0.85) { // Top ~15%
            color = '#ef4444'; // Red
        } else if (i > barCount * 0.6) { // Middle 25%
            color = '#facc15'; // Yellow
        }
        
        if (i < onBars) {
            canvasCtx.fillStyle = color;
        } else {
            canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.1)'; 
        }
        
        canvasCtx.fillRect(0, y, logicalWidth, barHeight);
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [analyserNode]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: `100%` }} />;
};

export default React.memo(VUMeter);
