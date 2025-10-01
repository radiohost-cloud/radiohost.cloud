import React from 'react';

// Using a div with styled spans for the animation as it's simpler for this effect.
export const NowPlayingIcon: React.FC<React.HTMLAttributes<HTMLDivElement>> = (props) => (
    <div className="flex items-end justify-center gap-0.5 h-4 w-4" {...props}>
         <style>{`
            .now-playing-bar {
                display: inline-block;
                width: 3px;
                background-color: currentColor;
                animation: play .9s linear infinite alternate;
                border-radius: 2px;
            }
            @keyframes play {
                0% { height: 25%; }
                100% { height: 100%; }
            }
        `}</style>
        <span className="now-playing-bar" style={{ animationDelay: '-1.2s', height: '25%' }} />
        <span className="now-playing-bar" style={{ animationDelay: '-1.5s', height: '50%' }} />
        <span className="now-playing-bar" style={{ animationDelay: '-0.9s', height: '75%' }} />
    </div>
);
