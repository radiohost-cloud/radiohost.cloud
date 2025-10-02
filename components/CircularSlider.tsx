import React, { useRef, useCallback } from 'react';

interface CircularSliderProps {
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
    size?: number;
    trackWidth?: number;
    thumbSize?: number;
    trackColor?: string;
    progressColor?: string;
}

const CircularSlider: React.FC<CircularSliderProps> = ({
    value,
    min,
    max,
    onChange,
    size = 150,
    trackWidth = 12,
    thumbSize = 18,
    trackColor = '#e0e0e0',
    progressColor = '#3b82f6',
}) => {
    const sliderRef = useRef<SVGSVGElement>(null);

    const center = size / 2;
    const radius = center - Math.max(trackWidth, thumbSize) / 2;
    const startAngle = -135;
    const endAngle = 135;
    const angleRange = endAngle - startAngle;

    const valueToAngle = (val: number) => {
        const valueRatio = (val - min) / (max - min);
        return startAngle + valueRatio * angleRange;
    };

    const angleToValue = (angle: number) => {
        let currentAngle = angle;
        if (currentAngle < startAngle) {
            currentAngle += 360;
        }
        const angleRatio = (currentAngle - startAngle) / angleRange;
        const val = min + angleRatio * (max - min);
        return Math.max(min, Math.min(max, val));
    };

    const getCoordFromAngle = (angle: number, r = radius) => {
        const angleInRad = (angle - 90) * (Math.PI / 180);
        return {
            x: center + r * Math.cos(angleInRad),
            y: center + r * Math.sin(angleInRad),
        };
    };

    const describeArc = (x: number, y: number, r: number, start: number, end: number) => {
        const startPoint = getCoordFromAngle(start, r);
        const endPoint = getCoordFromAngle(end, r);
        const largeArcFlag = end - start <= 180 ? '0' : '1';
        return `M ${startPoint.x} ${startPoint.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${endPoint.x} ${endPoint.y}`;
    };

    const currentAngle = valueToAngle(value);
    const thumbPosition = getCoordFromAngle(currentAngle);

    const handleInteraction = (e: React.MouseEvent | React.TouchEvent) => {
        if (!sliderRef.current) return;

        const rect = sliderRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        
        const x = clientX - rect.left - center;
        const y = clientY - rect.top - center;

        const angle = (Math.atan2(y, x) * (180 / Math.PI)) + 90;
        let normalizedAngle = angle < 0 ? angle + 360 : angle;

        // Snap logic: if near start/end, snap to it.
        if (Math.abs(normalizedAngle - (endAngle + 360)) < 20 || Math.abs(normalizedAngle - endAngle) < 20) {
            normalizedAngle = endAngle;
        } else if (Math.abs(normalizedAngle - (startAngle + 360)) < 20) {
            normalizedAngle = startAngle;
        }
        
        onChange(angleToValue(normalizedAngle));
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const onMouseMove = (moveEvent: MouseEvent) => handleInteraction(moveEvent as any);
        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        e.preventDefault();
        const onTouchMove = (moveEvent: TouchEvent) => handleInteraction(moveEvent as any);
        const onTouchEnd = () => {
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onTouchEnd);
        };
        window.addEventListener('touchmove', onTouchMove);
        window.addEventListener('touchend', onTouchEnd);
    };


    return (
        <svg
            ref={sliderRef}
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            className="cursor-pointer"
        >
            {/* Track Background */}
            <path
                d={describeArc(center, center, radius, startAngle, endAngle)}
                fill="none"
                stroke={trackColor}
                strokeWidth={trackWidth}
                strokeLinecap="round"
            />
            {/* Progress Track */}
            <path
                d={describeArc(center, center, radius, startAngle, currentAngle)}
                fill="none"
                stroke={progressColor}
                strokeWidth={trackWidth}
                strokeLinecap="round"
            />
            {/* Thumb */}
            <circle
                cx={thumbPosition.x}
                cy={thumbPosition.y}
                r={thumbSize / 2}
                fill="white"
                stroke={progressColor}
                strokeWidth="3"
            />
        </svg>
    );
};

export default React.memo(CircularSlider);