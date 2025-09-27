
import React from 'react';

// FIX: Add IconProps to accept a 'title' prop, resolving a TypeScript error in Playlist.tsx.
interface IconProps extends React.SVGProps<SVGSVGElement> {
    title?: string;
}

export const VoiceTrackIcon: React.FC<IconProps> = ({ title, ...props }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
        {title && <title>{title}</title>}
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="3" y1="19" x2="21" y2="19"></line>
        <line x1="5" y1="22" x2="19" y2="22"></line>
    </svg>
);
