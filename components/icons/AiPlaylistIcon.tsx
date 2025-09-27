import React from 'react';

export const AiPlaylistIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    {...props}
  >
    <title>AI Playlist Generator</title>
    {/* Vinyl Record */}
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2.5" />
    
    {/* AI Circuit Lines */}
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.5V3" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3L10 5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3L14 5" />
    
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 8l3-3" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 5l-2 2" />

    <path strokeLinecap="round" strokeLinejoin="round" d="M8 8l-3-3" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5l2 2" />
  </svg>
);
