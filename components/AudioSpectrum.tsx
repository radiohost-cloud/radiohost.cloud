import React, { useRef, useEffect } from 'react';

interface AudioSpectrumProps {
  analyserNode: AnalyserNode | null;
  width: number;
  height: number;
}

const AudioSpectrum: React.FC<AudioSpectrumProps> = ({ analyserNode, width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!analyserNode) return;

    const canvas = canvasRef.current;
    const canvasCtx = canvas?.getContext('2d');
    if (!canvas || !canvasCtx) return;

    // Use a smaller FFT size for fewer, thicker bars which often looks better for a subtle effect
    analyserNode.fftSize = 128; 
    const bufferLength = analyserNode.frequencyBinCount; // this will be 64
    const dataArray = new Uint8Array(bufferLength);
    
    let animationFrameId: number;

    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);
      analyserNode.getByteFrequencyData(dataArray);

      canvasCtx.clearRect(0, 0, width, height);
      
      const barWidth = (width / bufferLength);
      let barHeight;
      let x = 0;

      const gradient = canvasCtx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0.6)');

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * height;
        
        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(x, height - barHeight, barWidth -1, barHeight);

        x += barWidth;
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [analyserNode, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};

export default React.memo(AudioSpectrum);