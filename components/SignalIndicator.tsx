import React from 'react';

interface SignalIndicatorProps {
    level: number; // 0-100
}

const SignalIndicator: React.FC<SignalIndicatorProps> = ({ level }) => {
    const hasSignal = level > 1;
    
    let staticColorClass = 'bg-neutral-500 dark:bg-neutral-600'; // Off
    if (hasSignal) {
        if (level > 95) {
            staticColorClass = 'bg-red-500'; // Clipping
        } else if (level > 80) {
            staticColorClass = 'bg-yellow-500'; // High
        } else {
            staticColorClass = 'bg-green-500'; // Normal
        }
    }

    // The pulse should always be green as requested.
    const pingColorClass = 'bg-green-500';

    return (
        <div className="flex items-center" title={`Signal Level: ${level.toFixed(0)}%`}>
            <span className={`relative flex h-3 w-3 rounded-full ${staticColorClass}`}>
                {hasSignal && (
                    <span 
                        className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${pingColorClass}`}
                    />
                )}
            </span>
        </div>
    );
};

export default React.memo(SignalIndicator);
