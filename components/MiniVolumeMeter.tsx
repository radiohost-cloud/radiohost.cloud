import React from 'react';

interface MiniVolumeMeterProps {
    level: number; // 0-100
}

const MiniVolumeMeter: React.FC<MiniVolumeMeterProps> = ({ level }) => {
    const peakLevel = Math.min(100, level); // Clamp level

    let bgColor = 'bg-green-500';
    if (peakLevel > 95) {
        bgColor = 'bg-red-500';
    } else if (peakLevel > 80) {
        bgColor = 'bg-yellow-500';
    }

    return (
        <div className="w-full h-1.5 bg-neutral-300 dark:bg-neutral-700 rounded-full overflow-hidden">
            <div
                className={`h-full rounded-full ${bgColor} transition-[width] duration-75 ease-linear`}
                style={{ width: `${peakLevel}%` }}
            />
        </div>
    );
};

export default React.memo(MiniVolumeMeter);
