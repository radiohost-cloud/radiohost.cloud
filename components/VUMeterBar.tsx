import React from 'react';

interface VUMeterBarProps {
    level: number; // 0-100
}

const VUMeterBar: React.FC<VUMeterBarProps> = ({ level }) => {
    const safeLevel = Math.max(0, Math.min(100, level));

    return (
        <div className="w-6 h-24 bg-neutral-900/50 rounded-md overflow-hidden border border-neutral-700/50 relative">
            <div 
                className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-green-500 via-yellow-500 to-red-500 transition-[height] duration-75 ease-out"
                style={{ height: `${safeLevel}%` }}
            />
            <div className="absolute inset-0 flex flex-col justify-between py-1">
                {[...Array(10)].map((_, i) => (
                    <div key={i} className="w-full h-px bg-neutral-900/80" />
                ))}
            </div>
        </div>
    );
};

export default React.memo(VUMeterBar);