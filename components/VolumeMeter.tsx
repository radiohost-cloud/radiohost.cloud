import React from 'react';

interface VolumeMeterProps {
    volume: number; // A value from 0 to 100
    barCount?: number;
}

const VolumeMeter: React.FC<VolumeMeterProps> = ({ volume, barCount = 48 }) => {
    
    const getBarColor = (level: number, index: number) => {
        const threshold = (index / barCount) * 100;
        if (level < threshold) return 'bg-neutral-800'; // Inactive part of the bar

        if (index < barCount * 0.65) return 'bg-green-500'; // Green zone
        if (index < barCount * 0.85) return 'bg-yellow-500'; // Yellow zone
        return 'bg-red-500'; // Red zone
    };

    return (
        <div className="flex items-center w-full h-full gap-px">
            {Array.from({ length: barCount }).map((_, index) => {
                 const barIsActive = (volume / 100) * barCount > index;
                 const colorClass = barIsActive ? getBarColor(volume, index) : 'bg-neutral-700';

                 return (
                    <div key={index} className="w-full h-full flex flex-col-reverse">
                         <div
                            className={`w-full rounded-sm transition-colors duration-75 ${colorClass}`}
                            style={{ height: '100%' }}
                         />
                    </div>
                );
            })}
        </div>
    );
};

export default React.memo(VolumeMeter);